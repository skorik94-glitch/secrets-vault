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

export function memoryStore(project, clock = () => new Date().toISOString()) {
  const base = path.join(project, ".agent");
  const P = {
    base,
    state: path.join(base, "state.md"),
    journal: path.join(base, "journal.jsonl"),
    decisions: path.join(base, "decisions.jsonl"),
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

  // Reconsolidation: drop any entry that a later entry has superseded — keep current truth.
  const active = (entries) => {
    const sup = new Set(entries.flatMap((e) => (e.supersedes ? [e.supersedes] : [])));
    return entries.filter((e) => !e.id || !sup.has(e.id));
  };
  const journal = (limit = 50) => active(readJsonl(P.journal)).slice(-limit);
  const decisionLog = (limit = 100) => active(readJsonl(P.decisions)).slice(-limit);

  // Retrieval: surface the MOST SALIENT crumbs first (surprises / key decisions /
  // mistakes), then recency — not just the latest noise.
  const recall = ({ limit = 20 } = {}) => {
    const crumbs = active(readJsonl(P.journal))
      .sort((a, b) => (b.salience || 3) - (a.salience || 3) || String(b.ts).localeCompare(String(a.ts)))
      .slice(0, limit);
    return {
      project,
      state: getState(),
      decisions: decisionLog(50),
      crumbs,
      hasMemory: fs.existsSync(P.state) || fs.existsSync(P.journal),
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
    if (!terms.length) return { query, crumbs: [], decisions: [], stateMatch: false };
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
      stateMatch: score(getState()) > 0,
    };
  };

  return { getState, setState, remember, recordDecision, journal, decisionLog, recall, search, consolidate, paths: P };
}
