// Human-readable rendering of a scan report. The structured report is already
// JSON-serializable; this just formats a terminal summary.

import path from "node:path";
import os from "node:os";

const SEV_ICON = { critical: "[CRIT]", high: "[HIGH]", medium: "[MED ]", low: "[LOW ]", info: "[INFO]" };
const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

function home(p) {
  const h = os.homedir();
  return p.startsWith(h) ? "~" + p.slice(h.length) : p;
}

export function buildSummaryText(report) {
  const L = [];
  const { stats, leaks, duplicates, projects, scanned, errors } = report;

  L.push("=".repeat(72));
  L.push("  SECRETS INVENTORY — summary");
  L.push("=".repeat(72));
  L.push(`  generated : ${report.generatedAt}`);
  L.push(`  roots     : ${report.roots.map(home).join(", ")}`);
  L.push(`  scanned   : ${scanned.dirs} dirs, ${scanned.files} files`);
  L.push(`  found     : ${stats.total} secret-bearing files`);
  L.push("");

  // Severity breakdown
  L.push("  By severity:");
  for (const s of SEV_ORDER) {
    if (stats.bySeverity[s]) L.push(`    ${SEV_ICON[s]} ${String(stats.bySeverity[s]).padStart(4)}  ${s}`);
  }
  L.push("");

  // Service breakdown
  const services = Object.entries(stats.byService).sort((a, b) => b[1] - a[1]);
  if (services.length) {
    L.push("  By service:");
    for (const [svc, n] of services) L.push(`    ${String(n).padStart(4)}  ${svc}`);
    L.push("");
  }

  // Leaks — the part that needs action.
  if (leaks.length) {
    L.push("-".repeat(72));
    L.push(`  LEAKS / EXPOSURES (${leaks.length}) — review these first:`);
    L.push("-".repeat(72));
    for (const f of leaks.slice(0, 40)) {
      L.push(`  ${SEV_ICON[f.severity]} ${home(f.path)}`);
      L.push(`         ${f.flags.join(", ")}  ·  ${f.services.join("/")}  ·  mode ${f.mode}`);
    }
    if (leaks.length > 40) L.push(`  … and ${leaks.length - 40} more (see JSON report)`);
    L.push("");
  } else {
    L.push("  No git-committed or world-readable secrets detected. ");
    L.push("");
  }

  // Duplicate credentials — same secret reused across projects.
  if (duplicates.length) {
    L.push("-".repeat(72));
    L.push(`  REUSED CREDENTIALS (${duplicates.length}) — same value in multiple files:`);
    L.push("-".repeat(72));
    for (const d of duplicates.slice(0, 15)) {
      L.push(`  fp ${d.fingerprint} ×${d.count}`);
      for (const p of d.paths.slice(0, 6)) L.push(`       ${home(p)}`);
      if (d.paths.length > 6) L.push(`       … +${d.paths.length - 6} more`);
    }
    L.push("");
  }

  // Top projects by secret count.
  if (projects.length) {
    L.push("-".repeat(72));
    L.push("  TOP LOCATIONS:");
    L.push("-".repeat(72));
    for (const p of projects.slice(0, 12)) {
      L.push(`  ${String(p.count).padStart(3)}  ${home(p.root)}`);
    }
    L.push("");
  }

  if (errors.length) {
    L.push(`  (${errors.length} paths could not be read — permissions/IO; see JSON report)`);
    L.push("");
  }

  L.push("!".repeat(72));
  L.push("  This report maps WHERE your secrets live. Treat it as sensitive.");
  L.push("  It does NOT contain secret values (only paths, types, fingerprints).");
  L.push("  The output file is gitignored — do not commit or share it.");
  L.push("!".repeat(72));

  return L.join("\n");
}

export { home, path };
