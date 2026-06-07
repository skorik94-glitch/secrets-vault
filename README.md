# Hush

**See every secret you've leaked across your machine — then give your AI agent access without ever exposing the values.**

[![GitHub stars](https://img.shields.io/github/stars/skorik94-glitch/hush?style=social)](https://github.com/skorik94-glitch/hush)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen)
![Runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-blue)

Local-first, open-source secrets + service-context copilot for AI coding agents
(Claude Code, Cursor, Codex, Windsurf…). Inventory your scattered credentials,
audit leaks, keep per-service runbooks, and let agents work with *references* —
real values only behind Touch ID.

```bash
# One read-only command. No install, no account.
npx -y github:skorik94-glitch/hush scan
```

```text
  found     : 312 secret-bearing files          ← example output
  [CRIT]  41  critical   [HIGH]  88  high
  LEAKS / EXPOSURES (96): committed to git, world-readable keys, reused tokens
```

**Why it's different**
- **Leak scanner** — finds secrets committed to git, world-readable keys, and the same token reused across projects.
- **Safe for AI agents** — reference-only by default; real values only via a biometric-gated `reveal`. No raw keys in the agent's context.
- **Trust by design** — local-first (your secrets never leave your machine), **zero runtime dependencies**, open source.
- **Reuse access** — provision a new project with the same credentials in one move.

## Status

Assembled and unit-tested (45 tests): discover → onboard → vault → MCP (with
per-service runbooks) → provisioning → E2EE sync, packaged as a Claude Code
plugin. Pending live testing against a real Infisical / Claude Code / Touch ID.
See [ExecPlan.md](./ExecPlan.md). Security model: [SECURITY.md](./SECURITY.md).

## Install as a Claude Code plugin

**One line (terminal):**

```
claude plugin marketplace add skorik94-glitch/hush && claude plugin install hush@hush
```

…or run `./install.sh`. Or, inside Claude Code: `/plugin` → add
`skorik94-glitch/hush` → install. Then restart Claude Code (or
`/reload-plugins`) and run `/hush:doctor`.

Bundles the MCP server, a skill (proactive reference-only behaviour), and slash
commands: `/hush:doctor`, `:services`, `:playbook <service>`, `:onboard`.
Manual MCP-only alternative: `claude mcp add hush -- node "$(pwd)/src/mcp-server.mjs"`.

## Use it from any client

Not on Claude Code? It's also a plain MCP server + CLI you can run anywhere with
zero install (public repo, zero deps):

```
npx -y github:skorik94-glitch/hush doctor
# or: brew install skorik94-glitch/tap/hush
```

Copy-paste setup for Cursor, Windsurf, Claude Desktop, Cline, Zed, OpenAI Codex,
and the raw CLI is in [INTEGRATIONS.md](./INTEGRATIONS.md).

## Requirements

- Node.js >= 20 (the tool has **zero npm dependencies**)
- `git`, `sqlite3` (preinstalled on macOS)
- Optional: `swift` (Xcode CLT) for the Touch ID reveal gate; Infisical machine
  identity for the live vault backend

Run `npm run doctor` (or `hush doctor`) to check all of the above.

## Quick start

```bash
npm run doctor                          # preflight

hush scan --yes                # inventory secrets across $HOME (read-only)
hush discover --scan --yes     # which services you use + gaps/stale

# Onboard into Infisical (needs a machine identity in the environment):
export INFISICAL_API_URL=http://localhost:8080   # or cloud
export INFISICAL_PROJECT_ID=...  INFISICAL_CLIENT_ID=...  INFISICAL_CLIENT_SECRET=...
hush onboard --from ~/.hush/inventory-report-*.json          # dry-run
hush onboard --from ~/.hush/inventory-report-*.json --apply --yes

# Expose the vault to Claude Code:
claude mcp add hush -- node "$(pwd)/src/mcp-server.mjs"
```

`npm test` runs the suite. Vault data (reports, knowledge, audit) lives in
`~/.hush/` (mode 0600); override with `SECRETS_VAULT_DIR`.

## Commands

| Command | What it does |
|---|---|
| `doctor` | Check prerequisites |
| `scan` | Read-only inventory + leak audit + reused-credential dedup |
| `discover` | Service discovery from browser history (history only — never passwords/cookies) |
| `onboard` | Plan/apply import of secrets into Infisical (dry-run by default, value-free plan) |
| `mcp` | Reference-only MCP server for Claude Code |
| `sync` | E2EE cross-device vault (per-device keys + biometric, zero-knowledge) |

## The MCP server

Tools: `list_services`, `list_credentials`, `find_projects`, `describe_project`,
`suggest_for_new_project`, `provision`, `reveal`, `materialize_file`,
`scan_for_leaks`, `audit_log`.

- **Reference-only by default** — metadata tools never return secret values.
- **`reveal` / `materialize_file` are gated** by a Touch ID system dialog (the
  model cannot self-approve) and written to an append-only audit log.
- **Backend:** Infisical when `INFISICAL_*` env vars are set, otherwise backed by
  the local scan reports.

## "Take the same access" (provisioning)

`provision` links a new project to the vault and wires Infisical **secret-imports**
from your shared folders (`/shared/<service>`) into the new app's folder
(`/apps/<name>`), then you run it with `infisical run -- <cmd>`. The new project
gets the same access with **no secret values written to its repo**.

## Cross-device (E2EE sync)

"Biometric access from any device", done the local-first way — no honeypot, no
webcam-to-cloud. A random vault key encrypts your secrets (AES-256-GCM); that key
is wrapped (X25519) to each enrolled device's public key, whose private key is
biometric-gated. The sync target is just an encrypted file you put in iCloud /
Dropbox / a git repo — it only ever holds ciphertext.

```bash
export SECRETS_VAULT_PASSPHRASE=...                       # protects this device's key at rest
hush sync init --secrets vault.json --remote ~/Dropbox/vault.enc.json
# on a second device:
hush sync device --label phone > phone.json      # share its public key
# back on the first device:
hush sync authorize --pubkey phone.json --remote ~/Dropbox/vault.enc.json
# now the phone can:
hush sync unlock --remote ~/Dropbox/vault.enc.json   # Touch ID, then decrypts
```

Revoking a device rotates the vault key and re-wraps to the rest. True WebAuthn
passkeys apply only if a sync *server* is later added — then they gate the server,
not the crypto.

## License

[MIT](./LICENSE)
