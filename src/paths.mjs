// Single source of truth for where vault data lives, so writers (scan/discover/
// onboard) and the MCP server agree — even when run from any project.
// Default: ~/.hush. Falls back to a legacy ~/.secrets-vault if present (no
// migration needed). Override with HUSH_DIR (or legacy SECRETS_VAULT_DIR).

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export function vaultDir() {
  const env = process.env.HUSH_DIR || process.env.SECRETS_VAULT_DIR || process.env.SECRETS_VAULT_HOME;
  if (env) return env;
  const home = path.join(os.homedir(), ".hush");
  const legacy = path.join(os.homedir(), ".secrets-vault");
  if (!existsSync(home) && existsSync(legacy)) return legacy; // keep existing data working
  return home;
}
