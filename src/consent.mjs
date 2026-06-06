// Explicit, per-run consent gate. This tool reads sensitive local data
// (files, keys, browser history), so it must never run without the user's
// informed consent. Decision logic is pure + testable; I/O is separate.

import readline from "node:readline";

/**
 * Decide how to obtain consent.
 * @returns {"proceed"|"prompt"|"refuse"}
 */
function consentError(message) {
  const e = new Error(message);
  e.expected = true; // an expected stop, not a crash — CLIs print message only
  return e;
}

export function consentDecision({ yes, isTTY, envYes }) {
  if (yes || envYes) return "proceed"; // explicit opt-in
  if (isTTY) return "prompt"; // a human is present — ask
  return "refuse"; // non-interactive without --yes: do not touch data
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

/**
 * Ensure the user consents before reading sensitive data.
 * Resolves true if allowed; throws if refused/declined.
 */
export async function ensureConsent({ action, scope = [], yes = false }) {
  const decision = consentDecision({
    yes,
    isTTY: !!process.stdin.isTTY,
    envYes: !!process.env.SECRETS_INVENTORY_YES,
  });

  if (decision === "proceed") return true;

  if (decision === "refuse") {
    throw consentError(
      `consent required before: ${action}\n` +
        `  This reads sensitive data on your machine. Nothing leaves the machine.\n` +
        `  Re-run with --yes (or set SECRETS_INVENTORY_YES=1) to confirm you consent.`,
    );
  }

  // prompt
  process.stderr.write(`\nAbout to: ${action}\n`);
  for (const s of scope) process.stderr.write(`  - ${s}\n`);
  process.stderr.write("  Read-only. Output stays on this machine (0600, gitignored).\n");
  const answer = await ask("Type 'yes' to continue: ");
  if (answer.trim().toLowerCase() !== "yes") {
    throw consentError("consent declined — aborting.");
  }
  return true;
}
