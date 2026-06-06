// Biometric approval gate for sensitive operations (reveal / materialize).
// Default on macOS: a real Touch ID prompt via the bundled Swift helper, which
// pops a SYSTEM dialog — out-of-band, so the model cannot approve on its own.
// Falls back to DENY when no approver is available (safe default).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SWIFT_HELPER = fileURLToPath(new URL("../native/touchid.swift", import.meta.url));

/** Pick the default approval provider for this environment. */
export function defaultProvider(env = process.env, platform = process.platform) {
  if (env.SECRETS_VAULT_APPROVE === "allow") return "allow"; // INSECURE dev override
  if (platform === "darwin") return "swift";
  return "deny";
}

function swiftApprove(reason) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn("swift", [SWIFT_HELPER, reason]);
    } catch {
      resolve(false);
      return;
    }
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Require approval for `reason`.
 * @param {string} reason  shown in the biometric dialog
 * @param {{provider?: string, approver?: (reason:string)=>Promise<boolean>|boolean}} opts
 */
export async function requireApproval(reason, { provider, approver } = {}) {
  if (typeof approver === "function") return !!(await approver(reason)); // injected (tests / custom)
  const p = provider || defaultProvider();
  if (p === "allow") {
    process.stderr.write("WARN: biometric gate bypassed (SECRETS_VAULT_APPROVE=allow)\n");
    return true;
  }
  if (p === "swift") return swiftApprove(reason);
  return false; // deny
}
