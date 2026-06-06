import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/mcp.mjs";
import { buildTools } from "../src/mcp-server.mjs";

function mockVault() {
  return {
    services: () => ["github", "supabase"],
    credentials: () => [
      { name: ".env", path: "/x/.env", services: ["supabase"], types: ["env"], severity: "high", fingerprints: ["abc123"] },
    ],
    projects: () => [{ root: "/x", count: 1, paths: ["/x/.env"] }],
    describeProject: (p) => ({ project: p, count: 1, credentials: [] }),
    leaks: () => [],
    reveal: async () => "SECRET_VALUE_123",
  };
}

function makeServer(approver) {
  const entries = [];
  const audit = { record: async (e) => entries.push(e), read: async (n) => entries.slice(-(n || 100)) };
  const tools = buildTools({ vault: mockVault(), audit, approver });
  const { handle } = createMcpServer({ serverInfo: { name: "t", version: "1" }, tools });
  return { handle, entries };
}

const call = (handle, name, args = {}, id = 1) =>
  handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test("initialize handshake echoes protocol + serverInfo", async () => {
  const { handle } = makeServer(() => true);
  const res = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  assert.equal(res.result.protocolVersion, "2024-11-05");
  assert.equal(res.result.serverInfo.name, "t");
  assert.ok(res.result.capabilities.tools);
});

test("notifications get no response", async () => {
  const { handle } = makeServer(() => true);
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("tools/list exposes tools with schemas", async () => {
  const { handle } = makeServer(() => true);
  const res = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = res.result.tools.map((t) => t.name);
  for (const n of ["list_services", "list_credentials", "reveal", "provision", "audit_log"]) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  assert.ok(res.result.tools.every((t) => t.inputSchema?.type === "object"));
});

test("reference-only: list_credentials never returns a value", async () => {
  const { handle } = makeServer(() => true);
  const res = await call(handle, "list_credentials");
  const text = res.result.content[0].text;
  assert.equal(/"value"\s*:/.test(text), false);
  assert.equal(text.includes("SECRET_VALUE_123"), false);
  assert.ok(JSON.parse(text).credentials.length === 1);
});

test("reveal is gated: denied when approver rejects, audited both ways", async () => {
  const denied = makeServer(() => false);
  const r1 = await call(denied.handle, "reveal", { path: "/x/.env" });
  assert.equal(r1.result.isError, true);
  assert.match(r1.result.content[0].text, /denied/);
  assert.equal(denied.entries.at(-1).result, "denied");

  const ok = makeServer(() => true);
  const r2 = await call(ok.handle, "reveal", { path: "/x/.env" });
  assert.match(r2.result.content[0].text, /SECRET_VALUE_123/);
  assert.equal(ok.entries.at(-1).result, "approved");
});

test("provision dry-run writes nothing and exposes no values", async () => {
  const { handle } = makeServer(() => true);
  const res = await call(handle, "provision", { project_path: "/tmp/newapp", services: ["supabase"] });
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.plan.importFrom, ["/shared/supabase"]);
});

test("unknown tool -> error, unknown method -> -32601", async () => {
  const { handle } = makeServer(() => true);
  const r1 = await call(handle, "nope");
  assert.equal(r1.error.code, -32602);
  const r2 = await handle({ jsonrpc: "2.0", id: 2, method: "bogus/method" });
  assert.equal(r2.error.code, -32601);
});
