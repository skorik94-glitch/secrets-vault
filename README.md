# Hush

**An external cortex for your AI coding agent — it remembers your project and carries your way of working, so the agent acts like an extension of you, not a command-executor.**

[![GitHub stars](https://img.shields.io/github/stars/skorik94-glitch/hush?style=social)](https://github.com/skorik94-glitch/hush)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen)
![Runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-blue)

Local-first, open-source memory + access layer for AI coding agents (Claude Code, Cursor,
Codex, Windsurf…). Give your agent a real memory per project — the decisions and the *why*
behind them, plus your standing rules (identity, do-not, taste, invariants) — and, because
an agent also needs *access*, reference-only secrets. It stops re-explaining the project
every session, and stops "the agent misunderstood me."

## The problem

Your agent forgets. Every new session it loses the thread: the decisions you made, what
you rejected and why, your taste, the rules of the codebase. So it re-asks, re-breaks
things, drifts off-intent. The context lives in your head and evaporates between chats —
and code only shows *what* you did, never *what you rejected and why*.

## What it does

**Project memory that compounds.** `recall` at the start of a session restores the living
state, recent decisions, and crumbs — the *why* things are the way they are. Salience
surfaces surprises and mistakes first; consolidation ("sleep") compresses ten episodes
about the same rake into one lesson, so signal survives and the journal never becomes a
swamp. `search_memory` finds the why from months ago, including archived history.

**Your constitution, carried into the agent.** Record standing lenses with
`record_standing` — identity/telos, do-not constraints, taste, world-model invariants,
learned rules. `recall` serves them **first**, so the agent gets "who we are + the rules +
the map" *before* it touches code, and optimizes for the whole instead of the local task.

**Never relearn a mistake.** Reconsolidation: a corrected fact supersedes the old one (kept
in history, with the reason for the reversal). A repeated mistake becomes a rule, not a
recurring bug.

**Safe access for the agent (the secrets organ).** An agent needs access, not just memory.
Inventory your scattered credentials, scan for leaks, and let the agent work with
*references* — real values only behind a biometric-gated `reveal`. No raw keys in the
agent's context. `provision` gives a new project the same access in one move.

## Why it's different

- **Carries the WHY, not just facts** — intent, rejected options, taste: the stuff code
  can't regenerate and that dies when the session closes. Most memory tools store the
  regenerable facts; the gold is the unrecoverable *why*.
- **Constitution-first recall** — identity and do-not lead every session, so the agent
  works the way you work.
- **Local-first, zero runtime dependencies, open source** — your memory and secrets never
  leave your machine. Trust by design; there's nothing to exfiltrate.

## Try the free leak scanner (no install, 10s)

```bash
npx -y github:skorik94-glitch/hush scan
```

```text
  found     : 312 secret-bearing files          ← example output
  [CRIT]  41  critical   [HIGH]  88  high
```

A fast way in — see what's exposed on your machine. The memory layer is the rest of the
product.

## Status

Assembled and unit-tested (58 tests): memory (recall / remember / record_standing /
consolidate / search) + discover → onboard → vault → MCP → provisioning → E2EE sync,
packaged as a Claude Code plugin. Live testing on a real machine is in progress. See
[SECURITY.md](./SECURITY.md) for the threat model.

## Install as a Claude Code plugin

**One line (terminal):**

```
claude plugin marketplace add skorik94-glitch/hush && claude plugin install hush@hush
```

…or, inside Claude Code: `/plugin marketplace add skorik94-glitch/hush` then
`/plugin install hush@hush` (on first add it asks to **Trust** the repo). Install
auto-enables it — then **restart Claude Code** to load the MCP server + hooks.

Bundles the MCP server, two skills (`memory` — the recall→remember→consolidate loop; and
reference-only secrets behaviour), and slash commands: `/hush:recall`, `:doctor`,
`:services`, `:playbook <service>`, `:onboard`. Manual MCP-only alternative:
`claude mcp add hush -- node "$(pwd)/src/mcp-server.mjs"`.

## Requirements

- Node.js ≥ 20 (the tool has **zero npm dependencies**)
- `git`, `sqlite3` (preinstalled on macOS)
- Optional: `swift` (Xcode CLT) for the Touch ID `reveal` gate; Infisical machine identity
  for the live vault backend. *On non-macOS, `reveal`/`materialize_file` fail closed
  (deny) — memory, scan, inventory, playbooks, and provisioning still work.*

Run `npm run doctor` to check all of the above.

## How the memory works

Per project, in `<repo>/.agent/` (plain files, git-versionable, travels with the repo):

- **`standing.jsonl`** — the constitution: identity/telos, do-not constraints, taste,
  world-model invariants, learned rules. Surfaced **first** by `recall`.
- **`state.md`** — the living "where things stand" summary.
- **`decisions.jsonl`** — durable decisions (title + why + rejected alternatives).
- **`journal.jsonl`** — crumbs: significant events with the *why*, salience-tagged.

The cycle: **recall** (restore context) → **remember / record_decision / record_standing**
(capture the why as you work) → **consolidate** ("sleep": compress the journal, keep the
high-salience, archive the rest). A SessionStart hook auto-injects the briefing — every
session starts with the constitution and recent context already loaded.

## MCP tools

**Memory / cortex:** `recall`, `remember`, `record_decision`, `record_standing`,
`update_state`, `consolidate`, `search_memory`, `local_context`, `doc_map`.

**Access / secrets:** `list_services`, `list_credentials`, `find_projects`,
`describe_project`, `suggest_for_new_project`, `provision`, `reveal`, `materialize_file`,
`scan_for_leaks`, `audit_log`, `get_service_playbook`, `set_service_note`,
`list_app_services`.

- Memory is local files; secrets are **reference-only** — metadata tools never return
  values.
- `reveal` / `materialize_file` are **gated** by a Touch ID system dialog (the model
  cannot self-approve) and written to an append-only audit log.
- **Backend:** Infisical when `INFISICAL_*` env vars are set, otherwise the local scan
  reports.

## Use it from any client

Not on Claude Code? It's also a plain MCP server + CLI you can run anywhere with zero
install (public repo, zero deps):

```
npx -y github:skorik94-glitch/hush doctor
```

Copy-paste setup for Cursor, Windsurf, Claude Desktop, Cline, Zed, OpenAI Codex, and the
raw CLI is in [INTEGRATIONS.md](./INTEGRATIONS.md).

## "Take the same access" (provisioning)

`provision` links a new project to the vault and wires Infisical **secret-imports** from
your shared folders (`/shared/<service>`) into the new app's folder (`/apps/<name>`), then
you run it with `infisical run -- <cmd>`. The new project gets the same access with **no
secret values written to its repo**.

## Cross-device (E2EE sync)

"Biometric access from any device", done the local-first way — no honeypot, no
webcam-to-cloud. A random vault key encrypts your secrets (AES-256-GCM); that key is
wrapped (X25519) to each enrolled device's public key, whose private key is biometric-gated.
The sync target is just an encrypted file you put in iCloud / Dropbox / a git repo — it
only ever holds ciphertext.

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

Revoking a device rotates the vault key and re-wraps to the rest.

## License

[MIT](./LICENSE)
