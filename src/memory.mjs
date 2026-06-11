// Per-project memory for AI coding agents — the core of the memory layer.
// Stores a living state summary + a decision log + a journal of "crumbs"
// (significant events: decisions, problems solved, direction changes, learned
// constraints, mistakes). Lives in <project>/.agent/ so it travels with the repo
// (portable, git-versionable). Zero dependencies.
//
// The engine = storage + retrieval. The cognition (what to remember, how to
// consolidate) is driven by the agent via the `memory` skill.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const clean = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k];
  return o;
};

// Salience = how much a crumb matters (research: surprise/novelty marks importance).
// 1 = routine, 3 = normal, 5 = surprising/critical (a mistake, a key decision).
const clampSalience = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
};

// Standing artifacts ("constitution"): durable LENSES the agent should always apply,
// not events. Kinds map to the external-cortex layers: identity/telos (L1),
// world-model (L2), constraint/do-not (L8), taste (L10), learning (L11).
const STANDING_KINDS = new Set(["identity", "world-model", "constraint", "taste", "learning"]);
const clampKind = (k) => (STANDING_KINDS.has(k) ? k : "learning");

export function memoryStore(project, clock = () => new Date().toISOString()) {
  const base = path.join(project, ".agent");
  const P = {
    base,
    state: path.join(base, "state.md"),
    journal: path.join(base, "journal.jsonl"),
    decisions: path.join(base, "decisions.jsonl"),
    standing: path.join(base, "standing.jsonl"),
    archive: path.join(base, "archive"),
  };
  const ensure = () => fs.mkdirSync(base, { recursive: true });
  const readJsonl = (f) => {
    try {
      return fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  const getState = () => {
    try {
      return fs.readFileSync(P.state, "utf8");
    } catch {
      return "";
    }
  };
  const setState = (content) => {
    ensure();
    const text = String(content ?? "");
    fs.writeFileSync(P.state, text.endsWith("\n") ? text : text + "\n");
    return true;
  };

  // A crumb: what happened, WHY (required), what was rejected, when to revisit, refs.
  const remember = (c = {}) => {
    ensure();
    const entry = clean({
      id: randomUUID().slice(0, 8),
      ts: clock(),
      what: c.what,
      why: c.why,
      rejected: c.rejected,
      revisitIf: c.revisitIf,
      refs: c.refs,
      tags: c.tags,
      salience: clampSalience(c.salience),
      supersedes: c.supersedes, // id of a crumb this one replaces (reconsolidation)
    });
    fs.appendFileSync(P.journal, JSON.stringify(entry) + "\n");
    return entry;
  };

  const recordDecision = (c = {}) => {
    ensure();
    const entry = clean({
      id: randomUUID().slice(0, 8),
      ts: clock(),
      title: c.title,
      why: c.why,
      rejected: c.rejected,
      refs: c.refs,
      supersedes: c.supersedes, // id of a decision this one replaces
    });
    fs.appendFileSync(P.decisions, JSON.stringify(entry) + "\n");
    return entry;
  };

  // A STANDING artifact: a durable lens (identity/telos, a world-model fact, a
  // constraint/do-not, a taste rule, a learned rule). Surfaced FIRST by recall —
  // it's "how to think about this project", not an event. supersedes lets it be
  // revised while keeping the prior version (with its reason) in history.
  const recordStanding = (c = {}) => {
    ensure();
    const entry = clean({
      id: randomUUID().slice(0, 8),
      ts: clock(),
      kind: clampKind(c.kind),
      subtype: c.subtype, // world-model: invariant|contract|boundary…; taste: do|dont|anti-ref
      title: c.title,
      body: c.body,
      refs: c.refs, // pointer to verifiable ground truth (code/test) — epistemics
      supersedes: c.supersedes,
      supersedeReason: c.supersedeReason,
    });
    fs.appendFileSync(P.standing, JSON.stringify(entry) + "\n");
    return entry;
  };

  // Reconsolidation: drop any entry that a later entry has superseded — keep current truth.
  const active = (entries) => {
    const sup = new Set(entries.flatMap((e) => (e.supersedes ? [e.supersedes] : [])));
    return entries.filter((e) => !e.id || !sup.has(e.id));
  };
  const journal = (limit = 50) => active(readJsonl(P.journal)).slice(-limit);
  const decisionLog = (limit = 100) => active(readJsonl(P.decisions)).slice(-limit);
  const standing = () => active(readJsonl(P.standing));
  const groupStanding = () => {
    const live = standing();
    const by = (k) => live.filter((e) => e.kind === k);
    return { identity: by("identity"), worldModel: by("world-model"), constraints: by("constraint"), taste: by("taste"), learnings: by("learning") };
  };

  // Retrieval: identity/telos FIRST, then the standing lenses (world-model, do-not,
  // taste, learnings) ABOVE the event stream — so the agent gets "who we are + the
  // rules + the map" before "what happened". Crumbs: most salient first, then recency.
  const recall = ({ limit = 20 } = {}) => {
    const crumbs = active(readJsonl(P.journal))
      .sort((a, b) => (b.salience || 3) - (a.salience || 3) || String(b.ts).localeCompare(String(a.ts)))
      .slice(0, limit);
    const s = groupStanding();
    return {
      project,
      identity: s.identity, // rendered first — telos / who this is for / non-goals
      constitution: { worldModel: s.worldModel, constraints: s.constraints, taste: s.taste, learnings: s.learnings },
      state: getState(),
      decisions: decisionLog(50),
      crumbs,
      hasMemory: fs.existsSync(P.state) || fs.existsSync(P.journal) || fs.existsSync(P.standing),
    };
  };

  // Consolidation ("sleep"): without newState, return raw crumbs for the agent to
  // compress; with newState, write it and archive the raw journal.
  const consolidate = ({ newState } = {}) => {
    const raw = readJsonl(P.journal);
    if (newState == null) {
      const live = active(raw);
      return {
        mode: "read",
        count: live.length,
        keep: live.filter((e) => (e.salience || 3) >= 4), // high-salience → keep / generalize
        prune: live.filter((e) => (e.salience || 3) <= 2), // low-salience → likely drop
        crumbs: live,
        state: getState(),
      };
    }
    ensure();
    fs.mkdirSync(P.archive, { recursive: true });
    if (fs.existsSync(P.journal)) {
      const stamp = clock().replace(/[:.]/g, "-");
      fs.renameSync(P.journal, path.join(P.archive, `journal-${stamp}.jsonl`));
    }
    setState(newState);
    return { mode: "written", archivedCrumbs: raw.length };
  };

  // Keyword search across crumbs + decisions, INCLUDING archived (consolidated)
  // history — so the "why" from months ago is still findable on a long project.
  const search = (query, { limit = 20 } = {}) => {
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return { query, crumbs: [], decisions: [], standing: [], stateMatch: false };
    const score = (v) => {
      const t = String(Array.isArray(v) ? v.join(" ") : (v ?? "")).toLowerCase();
      return terms.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    };
    const rank = (items, fields) =>
      items
        .map((it) => ({ it, s: fields.reduce((a, f) => a + score(it[f]), 0) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.it);
    const archived = [];
    try {
      for (const f of fs.readdirSync(P.archive)) if (f.endsWith(".jsonl")) archived.push(...readJsonl(path.join(P.archive, f)));
    } catch {
      /* no archive */
    }
    return {
      query,
      crumbs: rank([...archived, ...readJsonl(P.journal)], ["what", "why", "rejected", "revisitIf", "refs", "tags"]),
      decisions: rank(readJsonl(P.decisions), ["title", "why", "rejected", "refs"]),
      standing: rank(readJsonl(P.standing), ["title", "body", "kind", "subtype", "refs"]),
      stateMatch: score(getState()) > 0,
    };
  };

  return { getState, setState, remember, recordDecision, recordStanding, journal, decisionLog, standing, groupStanding, recall, search, consolidate, paths: P };
}
