import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { memoryStore } from "../src/memory.mjs";

test("memory: crumbs, state, decisions, recall", async () => {
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mem-")));
  try {
    const m = memoryStore(proj);
    assert.equal(m.recall().hasMemory, false);

    m.remember({ what: "chose AES-256-GCM", why: "authenticated encryption", rejected: "CBC", revisitIf: "perf issue" });
    m.remember({ what: "fixed flaky test", why: "macOS /var symlink" });
    m.recordDecision({ title: "local-first, no honeypot", why: "trust is the product" });
    m.setState("# State\nProject is a memory layer.\n");

    const r = m.recall();
    assert.equal(r.state.includes("memory layer"), true);
    assert.equal(r.crumbs.length, 2);
    const aes = r.crumbs.find((c) => c.what.includes("AES"));
    const flaky = r.crumbs.find((c) => c.what.includes("flaky"));
    assert.equal(aes.why, "authenticated encryption");
    assert.equal("rejected" in flaky, false); // empty fields stripped
    assert.equal(r.decisions.length, 1);
    assert.equal(r.hasMemory, true);
    assert.ok(aes.ts && aes.id);
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
  }
});

test("memory: consolidate reads raw then archives + sets state", async () => {
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mem-")));
  try {
    const m = memoryStore(proj);
    m.remember({ what: "a", why: "b" });
    m.remember({ what: "c", why: "d" });

    const peek = m.consolidate();
    assert.equal(peek.mode, "read");
    assert.equal(peek.count, 2);

    const res = m.consolidate({ newState: "# State\nconsolidated.\n" });
    assert.equal(res.mode, "written");
    assert.equal(res.archivedCrumbs, 2);
    assert.equal(m.getState().includes("consolidated"), true);
    assert.equal(m.journal().length, 0); // journal archived
    assert.equal(existsSync(m.paths.archive), true);
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
  }
});

test("memory: search finds crumbs incl. archived/consolidated history", async () => {
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mem-")));
  try {
    const m = memoryStore(proj);
    m.remember({ what: "wired Supabase service key", why: "backend auth" });
    m.remember({ what: "fixed CORS", why: "vercel preview" });
    m.consolidate({ newState: "# State\n" }); // archives the journal
    m.remember({ what: "added Stripe webhook", why: "payments" });

    const r = m.search("supabase");
    assert.equal(r.crumbs.length, 1); // found in ARCHIVED history
    assert.match(r.crumbs[0].what, /Supabase/);
    assert.equal(m.search("payments").crumbs.length, 1); // current journal
    assert.equal(m.search("zzzznope").crumbs.length, 0);
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
  }
});

test("memory: salience ordering, supersede (reconsolidation), consolidate split", async () => {
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mem-")));
  try {
    const m = memoryStore(proj);
    m.remember({ what: "renamed a var", why: "clarity", salience: 1 });
    m.remember({ what: "SURPRISE: infisical imports are per-project only", why: "shaped the vault layout", salience: 5 });

    // recall surfaces the most salient first
    const r = m.recall();
    assert.equal(r.crumbs[0].salience, 5);
    assert.match(r.crumbs[0].what, /SURPRISE/);

    // reconsolidation: a later crumb supersedes an earlier one
    const old = m.remember({ what: "use python http.server for preview", why: "simple" });
    m.remember({ what: "use a node http server for preview", why: "python CLT was broken", supersedes: old.id, salience: 4 });
    const r2 = m.recall();
    assert.equal(r2.crumbs.some((c) => c.id === old.id), false); // superseded → gone from current memory
    assert.ok(m.search("python http.server").crumbs.length >= 1); // but still in history/search

    // consolidate read-mode splits by salience
    const c = m.consolidate();
    assert.equal(c.mode, "read");
    assert.ok(c.keep.every((e) => (e.salience || 3) >= 4));
    assert.ok(c.prune.every((e) => (e.salience || 3) <= 2));
    assert.ok(c.keep.length >= 1 && c.prune.length >= 1);
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
  }
});
