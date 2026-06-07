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
