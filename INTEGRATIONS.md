# Integrations — use it from any AI client

The core is a local **MCP server** plus a **CLI**, both zero-dependency. Because
the repo is public, you can run either with `npx` straight from GitHub — no clone,
no install step (zero deps = fast):

```
npx -y github:skorik94-glitch/secrets-vault <command>
```

`<command>` is one of `doctor`, `scan`, `discover`, `onboard`, `mcp`, `sync`.
(After a future npm publish this becomes `npx -y secrets-vault <command>`.)

Vault data lives centrally in `~/.secrets-vault/` for every surface, so what you
scan once is visible everywhere. Override with `SECRETS_VAULT_DIR`.

---

## Claude Code (plugin) — richest experience

Bundles the MCP server + a proactive skill + slash commands.

```
claude plugin marketplace add skorik94-glitch/secrets-vault
claude plugin install secrets-vault@secrets-vault
```

## Claude Desktop / Cursor / Windsurf / Cline / Zed (any MCP client)

Add this to the client's MCP config (same shape everywhere):

```json
{
  "mcpServers": {
    "secrets-vault": {
      "command": "npx",
      "args": ["-y", "github:skorik94-glitch/secrets-vault", "mcp"]
    }
  }
}
```

Config file locations (typical):
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Cursor: `~/.cursor/mcp.json` (or per-project `.cursor/mcp.json`)
- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Cline / Zed: their MCP settings (same JSON under `mcpServers` / context servers)

## OpenAI Codex

```bash
codex mcp add secrets-vault -- npx -y github:skorik94-glitch/secrets-vault mcp
```

…or in `~/.codex/config.toml`:

```toml
[mcp_servers.secrets-vault]
command = "npx"
args = ["-y", "github:skorik94-glitch/secrets-vault", "mcp"]
```

## Plain CLI (no AI client)

```bash
npx -y github:skorik94-glitch/secrets-vault doctor
npx -y github:skorik94-glitch/secrets-vault scan --yes
npx -y github:skorik94-glitch/secrets-vault discover --scan --yes
```

Or via Homebrew:

```bash
brew install skorik94-glitch/tap/secrets-vault
secrets-vault doctor
```

Or clone once and link a global `secrets-vault` command:

```bash
git clone https://github.com/skorik94-glitch/secrets-vault && cd secrets-vault && npm link
secrets-vault doctor
```

## Developers (library / Claude Agent SDK / API)

The modules are plain ESM with no dependencies — import them directly
(`src/scan.mjs`, `src/vault.mjs`, `src/crypto.mjs`, …), or point any Agent
SDK / API app at the MCP server command above.

---

## Notes

- Requirements: Node ≥ 20, `git`, `sqlite3` (preinstalled on macOS). Optional:
  `swift` (Touch ID reveal gate), Infisical machine identity (live vault backend).
- For the Infisical backend, set `INFISICAL_API_URL` / `INFISICAL_PROJECT_ID` /
  `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` in the MCP server's `env`.
- Everything stays local; the only value-returning tool (`reveal`) is
  biometric-gated and audited.
