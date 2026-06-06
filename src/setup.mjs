#!/usr/bin/env node
// secrets-vault setup — print (or write) the MCP config for a given client.
// Makes "install in any client" a single command instead of hand-editing JSON.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// The command every MCP client runs. Public repo + zero deps => no install step.
export const SERVER = { command: "npx", args: ["-y", "github:skorik94-glitch/secrets-vault", "mcp"] };

export const CLIENTS = {
  "claude-code": { label: "Claude Code", kind: "plugin" },
  cursor: { label: "Cursor", kind: "json", path: "~/.cursor/mcp.json" },
  "claude-desktop": { label: "Claude Desktop", kind: "json", path: "~/Library/Application Support/Claude/claude_desktop_config.json" },
  windsurf: { label: "Windsurf", kind: "json", path: "~/.codeium/windsurf/mcp_config.json" },
  cline: { label: "Cline", kind: "manual", note: "Cline panel → MCP Servers → Configure (cline_mcp_settings.json)" },
  zed: { label: "Zed", kind: "manual", note: "Zed settings.json → context_servers" },
  codex: { label: "OpenAI Codex", kind: "codex" },
};

export const expandHome = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
export const clientPath = (client) => (CLIENTS[client]?.path ? expandHome(CLIENTS[client].path) : null);

/** Pure merge: add our server under mcpServers without clobbering existing config. */
export function mergedConfig(existing, name = "secrets-vault", entry = SERVER) {
  const out = { ...(existing || {}) };
  out.mcpServers = { ...(out.mcpServers || {}), [name]: entry };
  return out;
}

function writeJsonClient(absPath) {
  let existing = {};
  if (existsSync(absPath)) {
    try {
      existing = JSON.parse(readFileSync(absPath, "utf8"));
    } catch {
      throw new Error(`existing config is not valid JSON: ${absPath} (edit it by hand)`);
    }
    writeFileSync(absPath + ".bak", readFileSync(absPath)); // backup
  }
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(mergedConfig(existing), null, 2));
}

const jsonSnippet = () => JSON.stringify({ mcpServers: { "secrets-vault": SERVER } }, null, 2);

function instructions(client) {
  const c = CLIENTS[client];
  const L = [];
  if (c.kind === "plugin") {
    L.push("Claude Code (richest — plugin with skill + slash commands):");
    L.push("  claude plugin marketplace add skorik94-glitch/secrets-vault");
    L.push("  claude plugin install secrets-vault@secrets-vault");
  } else if (c.kind === "codex") {
    L.push("OpenAI Codex:");
    L.push("  codex mcp add secrets-vault -- npx -y github:skorik94-glitch/secrets-vault mcp");
  } else if (c.kind === "json") {
    L.push(`${c.label}: add to ${c.path}`);
    L.push(jsonSnippet());
    L.push(`(or run: secrets-vault setup ${client} --write)`);
  } else {
    L.push(`${c.label}: ${c.note}`);
    L.push(jsonSnippet());
  }
  return L.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const client = argv.find((a) => !a.startsWith("-"));

  if (!client || client === "help") {
    process.stdout.write("secrets-vault setup <client> [--write]\n\nClients: " + Object.keys(CLIENTS).join(", ") + "\n\n");
    process.stdout.write("Generic MCP config (works in any client):\n" + jsonSnippet() + "\n");
    return;
  }
  const c = CLIENTS[client];
  if (!c) throw new Error(`unknown client: ${client}. Known: ${Object.keys(CLIENTS).join(", ")}`);

  if (write && c.kind === "json") {
    const abs = clientPath(client);
    writeJsonClient(abs);
    process.stdout.write(`Wrote secrets-vault MCP server to ${abs}\nRestart ${c.label} to load it.\n`);
    return;
  }
  process.stdout.write(instructions(client) + "\n");
}

if (process.argv[1] && process.argv[1].endsWith("setup.mjs")) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }
}
