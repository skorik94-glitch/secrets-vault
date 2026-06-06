# Secrets Vault (local-first, open source)

One trusted, searchable place for a solo builder's scattered secrets — SSH keys,
Google/Apple/Supabase/contractor credentials — exposed to your AI coding agent
over MCP, so spinning up a new app can **reuse the same access** instead of
hunting for keys across projects.

**Local-first. Open source. No honeypot.** Secrets live on your machine and in
your own (self-hosted or cloud) [Infisical](https://infisical.com). The agent
sees *references and metadata*, never values — except a single biometric-gated
`reveal`. Optional zero-knowledge cross-device sync is a later, separate phase.

## Status

Assembled and unit-tested (45 tests): discover → onboard → vault → MCP (with
per-service runbooks) → provisioning → E2EE sync, packaged as a Claude Code
plugin. Pending live testing against a real Infisical / Claude Code / Touch ID.
See [ExecPlan.md](./ExecPlan.md). Security model: [SECURITY.md](./SECURITY.md).

## Install as a Claude Code plugin

**One line (terminal):**

```
claude plugin marketplace add skorik94-glitch/secrets-vault && claude plugin install secrets-vault@secrets-vault
```

…or run `./install.sh`. Or, inside Claude Code: `/plugin` → add
`skorik94-glitch/secrets-vault` → install. Then restart Claude Code (or
`/reload-plugins`) and run `/secrets-vault:doctor`.

Bundles the MCP server, a skill (proactive reference-only behaviour), and slash
commands: `/secrets-vault:doctor`, `:services`, `:playbook <service>`, `:onboard`.
Manual MCP-only alternative: `claude mcp add secrets-vault -- node "$(pwd)/src/mcp-server.mjs"`.

## Requirements

- Node.js >= 20 (the tool has **zero npm dependencies**)
- `git`, `sqlite3` (preinstalled on macOS)
- Optional: `swift` (Xcode CLT) for the Touch ID reveal gate; Infisical machine
  identity for the live vault backend

Run `npm run doctor` (or `secrets-vault doctor`) to check all of the above.

## Quick start

```bash
npm run doctor                          # preflight

secrets-vault scan --yes                # inventory secrets across $HOME (read-only)
secrets-vault discover --scan --yes     # which services you use + gaps/stale

# Onboard into Infisical (needs a machine identity in the environment):
export INFISICAL_API_URL=http://localhost:8080   # or cloud
export INFISICAL_PROJECT_ID=...  INFISICAL_CLIENT_ID=...  INFISICAL_CLIENT_SECRET=...
secrets-vault onboard --from ~/.secrets-vault/inventory-report-*.json          # dry-run
secrets-vault onboard --from ~/.secrets-vault/inventory-report-*.json --apply --yes

# Expose the vault to Claude Code:
claude mcp add secrets-vault -- node "$(pwd)/src/mcp-server.mjs"
```

`npm test` runs the suite. Vault data (reports, knowledge, audit) lives in
`~/.secrets-vault/` (mode 0600); override with `SECRETS_VAULT_DIR`.

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
secrets-vault sync init --secrets vault.json --remote ~/Dropbox/vault.enc.json
# on a second device:
secrets-vault sync device --label phone > phone.json      # share its public key
# back on the first device:
secrets-vault sync authorize --pubkey phone.json --remote ~/Dropbox/vault.enc.json
# now the phone can:
secrets-vault sync unlock --remote ~/Dropbox/vault.enc.json   # Touch ID, then decrypts
```

Revoking a device rotates the vault key and re-wraps to the rest. True WebAuthn
passkeys apply only if a sync *server* is later added — then they gate the server,
not the crypto.

## License

[MIT](./LICENSE)
