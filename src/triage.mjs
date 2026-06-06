#!/usr/bin/env node
// secrets-vault triage — prioritize and (optionally) fix the leaks found by `scan`.
// Prints COUNTS to the terminal; writes the detailed list (with paths) to a local
// 0600 file, not to stdout. --fix-perms can chmod 600 world-readable key files.

import { readFileSync, writeFileSync, readdirSync, chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { vaultDir } from "./paths.mjs";
import { ensureConsent } from "./consent.mjs";

// Key material whose lax permissions we can safely tighten to 0600.
const PERM_FIXABLE = new Set([
  "ssh_key", "private_key", "p8", "p12", "env", "api_key",
  "service_account_json", "keystore", "token_store", "password",
]);

/** Bucket leaks by priority. Pure — used by tests. */
export function buildTriage(report) {
  const leaks = report.leaks || [];
  const has = (f, flag) => (f.flags || []).includes(flag);
  const p1 = leaks.filter((f) => has(f, "committed-to-git"));
  const p2 = leaks.filter((f) => !has(f, "committed-to-git") && has(f, "group-or-world-readable"));
  const p3 = leaks.filter(
    (f) => !has(f, "committed-to-git") && !has(f, "group-or-world-readable") && has(f, "untracked-not-gitignored"),
  );
  const fixablePerms = p2.filter((f) => (f.types || []).some((t) => PERM_FIXABLE.has(t)));
  return { p1, p2, p3, fixablePerms, stats: { p1: p1.length, p2: p2.length, p3: p3.length, fixablePerms: fixablePerms.length } };
}

function latestReport() {
  const dir = vaultDir();
  const m = readdirSync(dir).filter((n) => n.startsWith("inventory-report-") && n.endsWith(".json")).sort();
  if (!m.length) throw new Error(`no scan report in ${dir} — run \`secrets-vault scan --yes\` first`);
  return path.join(dir, m[m.length - 1]);
}

function detailText(t) {
  const sec = (title, items, note) => {
    const L = [`## ${title} (${items.length})`, note, ""];
    for (const f of items) L.push(`- [${f.severity}] ${f.path}  (${(f.flags || []).join(", ")}; ${(f.services || []).join("/")})`);
    return L.join("\n") + "\n";
  };
  return [
    "# secrets-vault leak triage",
    "",
    sec("P1 — committed to git (rotate + purge history)", t.p1, "These secrets are in git history. Rotate them, then scrub history (git filter-repo / BFG)."),
    sec("P2 — group/world-readable (tighten perms)", t.p2, "Run `secrets-vault triage --fix-perms --apply` to chmod 600 key files."),
    sec("P3 — untracked, not gitignored (add to .gitignore)", t.p3, "Add these to .gitignore so they aren't committed."),
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const fixPerms = argv.includes("--fix-perms");
  const apply = argv.includes("--apply");
  const fromIdx = argv.indexOf("--from");
  const reportPath = fromIdx >= 0 ? argv[fromIdx + 1] : latestReport();

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const t = buildTriage(report);

  process.stdout.write("Leak triage (counts only; details written to a local file):\n");
  process.stdout.write(`  P1 committed-to-git      : ${t.stats.p1}  (rotate + purge history)\n`);
  process.stdout.write(`  P2 group/world-readable  : ${t.stats.p2}  (${t.stats.fixablePerms} key files chmod-fixable)\n`);
  process.stdout.write(`  P3 untracked-not-ignored : ${t.stats.p3}  (add to .gitignore)\n`);

  if (fixPerms) {
    if (!apply) {
      process.stdout.write(`\n[dry-run] would chmod 600 on ${t.fixablePerms.length} key file(s). Re-run with --apply.\n`);
    } else {
      await ensureConsent({
        action: `chmod 600 on ${t.fixablePerms.length} world-readable key file(s)`,
        scope: ["modifies file permissions only (not contents)"],
        yes: argv.includes("--yes"),
      });
      let fixed = 0;
      for (const f of t.fixablePerms) {
        try {
          chmodSync(f.path, 0o600);
          fixed++;
        } catch {
          /* skip unreadable/again */
        }
      }
      process.stdout.write(`\nFixed permissions on ${fixed}/${t.fixablePerms.length} file(s).\n`);
    }
  }

  const outDir = vaultDir();
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "triage-latest.md");
  writeFileSync(outPath, detailText(t), { mode: 0o600 });
  process.stdout.write(`\nFull prioritized list (with paths): ${outPath}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("triage.mjs")) {
  main().catch((e) => {
    process.stderr.write(e?.expected ? `\n${e.message}\n` : `error: ${e.message}\n`);
    process.exit(1);
  });
}
