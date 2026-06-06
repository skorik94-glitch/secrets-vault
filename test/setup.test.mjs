import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mergedConfig, clientPath, expandHome, SERVER, CLIENTS } from "../src/setup.mjs";

test("mergedConfig adds our server without clobbering existing", () => {
  const m = mergedConfig({ mcpServers: { other: { command: "x" } } });
  assert.equal(m.mcpServers.other.command, "x");
  assert.equal(m.mcpServers["secrets-vault"].command, "npx");
  assert.ok(m.mcpServers["secrets-vault"].args.includes("mcp"));
});

test("mergedConfig handles empty / undefined", () => {
  assert.ok(mergedConfig({}).mcpServers["secrets-vault"]);
  assert.ok(mergedConfig(undefined).mcpServers["secrets-vault"]);
});

test("clientPath + expandHome", () => {
  assert.ok(clientPath("cursor").endsWith("/.cursor/mcp.json"));
  assert.ok(expandHome("~/x").startsWith(os.homedir()));
  assert.equal(clientPath("codex"), null); // codex has no plain JSON path
});

test("known clients present", () => {
  for (const c of ["claude-code", "cursor", "codex", "windsurf", "claude-desktop"]) {
    assert.ok(CLIENTS[c], `missing client ${c}`);
  }
  assert.ok(SERVER.command === "npx");
});
