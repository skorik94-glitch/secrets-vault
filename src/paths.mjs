// Single source of truth for where vault data lives, so writers (scan/discover/
// onboard) and the MCP server agree — even when the plugin runs from any project.
// Default: ~/.secrets-vault (central). Override with SECRETS_VAULT_DIR.

import os from "node:os";
import path from "node:path";

export function vaultDir() {
  return (
    process.env.SECRETS_VAULT_DIR ||
    process.env.SECRETS_VAULT_HOME ||
    path.join(os.homedir(), ".secrets-vault")
  );
}
