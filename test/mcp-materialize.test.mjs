import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMcpServer } from "../src/mcp.mjs";
import { buildTools } from "../src/mcp-server.mjs";

function makeServer(approver) {
  const entries = [];
  const audit = { record: async (e) => entries.push(e), read: async () => entries };
  const vault = { reveal: async () => "PRIVATE-KEY-BYTES" };
  const tools = buildTools({ vault, audit, approver });
  const { handle } = createMcpServer({ serverInfo: { name: "t", version: "1" }, tools });
  return { handle, entries };
}
const call = (handle, name, args) =>
  handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

test("materialize_file writes the value when approved, never echoes it", async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mat-")));
  try {
    const dest = path.join(tmp, "id_ed25519");
    const { handle, entries } = makeServer(() => true);
    const res = await call(handle, "materialize_file", { path: "/x/.ssh/id_ed25519", dest });
    const out = JSON.parse(res.result.content[0].text);
    assert.equal(out.wrote, dest);
    assert.equal(out.bytes, "PRIVATE-KEY-BYTES".length);
    assert.equal(res.result.content[0].text.includes("PRIVATE-KEY-BYTES"), false, "value must not be echoed");
    assert.equal(await fs.readFile(dest, "utf8"), "PRIVATE-KEY-BYTES");
    assert.equal(entries.at(-1).result, "approved");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("materialize_file is denied without approval and writes nothing", async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mat-")));
  try {
    const dest = path.join(tmp, "id_ed25519");
    const { handle, entries } = makeServer(() => false);
    const res = await call(handle, "materialize_file", { path: "/x/.ssh/id_ed25519", dest });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /denied/);
    assert.equal(existsSync(dest), false, "no file should be written when denied");
    assert.equal(entries.at(-1).result, "denied");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
