import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../src/mcp-server.mjs", import.meta.url));

test("MCP server speaks stdio JSON-RPC end-to-end", { timeout: 15000 }, async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "si-mcp-")));
  const reportPath = path.join(tmp, "rep.json");
  const report = {
    files: [{ path: path.join(tmp, ".env"), services: ["supabase"], types: ["env"], severity: "high", project: tmp, flags: [], fingerprints: [] }],
    stats: { byService: { supabase: 1 } },
    projects: [{ root: tmp, count: 1, paths: [path.join(tmp, ".env")] }],
    leaks: [],
  };
  await fs.writeFile(reportPath, JSON.stringify(report));

  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, SECRETS_VAULT_SCAN_REPORT: reportPath, SECRETS_VAULT_DIR: tmp },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = [];
  let buf = "";
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout; got " + JSON.stringify(responses))), 12000);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          responses.push(m);
          if (m.id === 3) {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          /* ignore */
        }
      }
    });
    proc.on("error", reject);
  });

  const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_services", arguments: {} } });

  try {
    await done;
    const init = responses.find((r) => r.id === 1);
    assert.equal(init.result.serverInfo.name, "hush");
    const list = responses.find((r) => r.id === 2);
    assert.ok(list.result.tools.some((t) => t.name === "reveal"));
    const called = responses.find((r) => r.id === 3);
    assert.match(called.result.content[0].text, /supabase/);
  } finally {
    proc.kill();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
