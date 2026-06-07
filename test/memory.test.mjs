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
    assert.equal(r.crumbs[0].why, "authenticated encryption");
    assert.equal("rejected" in r.crumbs[1], false); // empty fields stripped
    assert.equal(r.decisions.length, 1);
    assert.equal(r.hasMemory, true);
    assert.ok(r.crumbs[0].ts);
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
