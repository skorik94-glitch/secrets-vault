import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { localContext, docMap } from "../src/docs.mjs";

test("localContext stacks nearest docs global -> local", async () => {
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-doc-")));
  try {
    await fs.writeFile(path.join(proj, "CLAUDE.md"), "root context");
    await fs.mkdir(path.join(proj, "src", "a"), { recursive: true });
    await fs.writeFile(path.join(proj, "src", "CLAUDE.md"), "src context");
    await fs.writeFile(path.join(proj, "src", "a", "foo.js"), "// code");

    const r = localContext("src/a/foo.js", proj);
    assert.equal(r.docs.length, 2);
    assert.equal(r.docs[0].level, "."); // root first
    assert.equal(r.docs[0].content, "root context");
    assert.equal(r.docs[1].level, "src"); // then nearer
    assert.equal(r.docs[1].content, "src context");

    // a path with no module doc still gets the root doc
    assert.equal(localContext("README.md", proj).docs.length, 1);
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
  }
});

test("docMap reports coverage and gaps, skips noise", async () => {
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-doc-")));
  try {
    await fs.writeFile(path.join(proj, "CLAUDE.md"), "root");
    await fs.mkdir(path.join(proj, "src"), { recursive: true });
    await fs.mkdir(path.join(proj, "node_modules", "x"), { recursive: true });
    const m = docMap(proj);
    assert.ok(m.withDocs.includes("."));
    assert.ok(m.without.includes("src"));
    assert.equal(m.withDocs.some((d) => d.includes("node_modules")), false);
    assert.ok(m.coverage > 0 && m.coverage <= 1);
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
  }
});
