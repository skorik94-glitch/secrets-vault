#!/usr/bin/env node
// Unified entrypoint: `secrets-vault <command> [...args]`.
// Dispatches to the per-command scripts, passing stdio through.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  setup: "setup.mjs",
  doctor: "doctor.mjs",
  scan: "cli.mjs",
  discover: "discover.mjs",
  triage: "triage.mjs",
  onboard: "onboard-cli.mjs",
  mcp: "mcp-server.mjs",
  sync: "sync-cli.mjs",
};

const USAGE = `secrets-vault <command> [options]

Commands:
  setup     print/write the MCP config for a client (cursor, codex, …)
  doctor    check prerequisites
  scan      inventory secrets/credentials across your machine (read-only)
  discover  discover which services you use (from browser history)
  triage    prioritize (and optionally fix) leaks found by scan
  onboard   import discovered secrets into Infisical (dry-run by default)
  mcp       run the MCP server for Claude Code / any MCP client (stdio)
  sync      E2EE cross-device vault (per-device keys + biometric)

Run 'secrets-vault <command> --help' for command options.
`;

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help") {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (!COMMANDS[cmd]) {
  process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(here, COMMANDS[cmd]), ...rest], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  process.stderr.write(`failed to run ${cmd}: ${err.message}\n`);
  process.exit(1);
});
