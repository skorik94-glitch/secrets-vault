#!/usr/bin/env node
// secrets-discover — service discovery from browser history (read-only).
// Surfaces which dev/SaaS services you actually use, and (optionally) cross-
// references them with the filesystem scan to find gaps and stale credentials.
//
// Reads ONLY browser history (urls/counts/times). Never passwords or cookies.
// Only catalog-matched dev services are surfaced; the rest of your history is
// neither stored nor shown.

import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readAllHistory } from "./browsers.mjs";
import { aggregateServices, crossReference } from "./services.mjs";
import { ensureConsent } from "./consent.mjs";
import { vaultDir } from "./paths.mjs";

const HELP = `secrets-discover — what services do you use? (from browser history)

Usage:
  node src/discover.mjs [options]

Options:
  --from <report.json>   Cross-reference against a prior filesystem scan report
  --scan                 Run a fresh filesystem scan first (slow) to cross-reference
  --out <file>           JSON output path. Default: .secrets-inventory/service-surface-<ts>.json
  --json                 Print full JSON to stdout instead of a file
  --top <n>              Show top N services in the summary (default 40)
  --quiet                Suppress progress
  --yes                  Consent to read sensitive local data (required non-interactively)
  -h, --help             Show this help

Reads only browser history. Never reads saved passwords or cookies.`;

function parseArgs(argv) {
  const o = { from: null, scan: false, out: null, json: false, top: 40, quiet: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--from") o.from = path.resolve(argv[++i]);
    else if (a === "--scan") o.scan = true;
    else if (a === "--out") o.out = path.resolve(argv[++i]);
    else if (a === "--json") o.json = true;
    else if (a === "--top") o.top = parseInt(argv[++i], 10);
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--yes") o.yes = true;
    else { process.stderr.write(`unknown option: ${a}\n`); o.help = true; }
  }
  return o;
}

const tsSlug = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—");

async function fsServicesFrom(o, log) {
  if (o.from) {
    try {
      const r = JSON.parse(readFileSync(o.from, "utf8"));
      return Object.keys(r.stats?.byService || {});
    } catch (e) {
      log(`could not read --from report: ${e.message}`);
      return null;
    }
  }
  if (o.scan) {
    const { scan } = await import("./scan.mjs");
    const { DEFAULT_SKIP_DIRS } = await import("./patterns.mjs");
    log("running filesystem scan (this can take a while)…");
    const r = await scan({
      roots: [os.homedir()],
      skipDirs: new Set([...DEFAULT_SKIP_DIRS, ".secrets-inventory"]),
      content: true,
    });
    return Object.keys(r.stats.byService);
  }
  return null;
}

function buildSummary(report) {
  const L = [];
  const { services, crossRef, sources, errors, top } = report;
  L.push("=".repeat(72));
  L.push("  SERVICE SURFACE — from browser history");
  L.push("=".repeat(72));
  L.push(`  generated : ${report.generatedAt}`);
  L.push(`  sources   : ${sources.map((s) => `${s.browser}/${s.profile} (${s.rows})`).join(", ") || "none"}`);
  L.push(`  services  : ${services.length} dev/SaaS services detected`);
  L.push("");

  L.push("  Services you use (visits · last seen · domains):");
  for (const s of services.slice(0, top)) {
    const tag = crossRef ? (crossRef.both.includes(s.service) ? " [has local cred]" : " [GAP: no local cred]") : "";
    L.push(`    ${String(s.visits).padStart(5)}  ${day(s.lastVisit)}  ${s.service} (${s.category})${tag}`);
  }
  L.push("");

  if (crossRef) {
    if (crossRef.gaps.length) {
      L.push("-".repeat(72));
      L.push(`  GAPS (${crossRef.gaps.length}) — used in browser, no NAMED local credential found:`);
      L.push("  (may be web-only, in a password manager, or stored as a generic env var)");
      L.push("-".repeat(72));
      for (const g of crossRef.gaps.slice(0, 25)) L.push(`    ${g.service}  ·  ${g.category}  ·  ${g.visits} visits`);
      L.push("");
    }
    if (crossRef.orphans.length) {
      L.push("-".repeat(72));
      L.push(`  POSSIBLY STALE (${crossRef.orphans.length}) — local credential, but service not in history:`);
      L.push("  (old/unused key? rotate or remove — or you only use it via API)");
      L.push("-".repeat(72));
      L.push("    " + crossRef.orphans.join(", "));
      L.push("");
    }
  } else {
    L.push("  (run with --from <report.json> or --scan to find gaps and stale credentials)");
    L.push("");
  }

  if (errors.length) {
    L.push(`  ${errors.length} history DB(s) unreadable:`);
    for (const e of errors) L.push(`    ${e.browser}/${e.profile}: ${e.error}`);
    L.push("  (Safari needs Terminal to have Full Disk Access in System Settings → Privacy.)");
    L.push("");
  }

  L.push("!".repeat(72));
  L.push("  Derived from browser history. Treat as sensitive; output is 0600 + gitignored.");
  L.push("  Only catalog-matched services are recorded — not your full history.");
  L.push("!".repeat(72));
  return L.join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return void process.stdout.write(HELP + "\n");
  const log = o.quiet ? () => {} : (m) => process.stderr.write(m + "\n");

  await ensureConsent({
    action: "read browser history to discover which services you use",
    scope: [
      "read browser history databases (read-only)",
      o.scan ? "scan local files for secrets (--scan)" : "no filesystem scan",
      "only catalog dev-services are recorded; the rest of your history is not",
    ],
    yes: o.yes,
  });

  log("Reading browser history (read-only)…");
  const { visits, sources, errors } = await readAllHistory();
  const services = aggregateServices(visits);

  const fsServices = await fsServicesFrom(o, log);
  const crossRef = fsServices ? crossReference(fsServices, services) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    sources,
    services,
    crossRef,
    errors,
    top: o.top,
  };

  if (o.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.stderr.write("\n" + buildSummary(report) + "\n");
    return;
  }

  const outPath = o.out || path.join(vaultDir(), `service-surface-${tsSlug(new Date())}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(buildSummary(report) + "\n");
  process.stdout.write(`\n  Full JSON: ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(err?.expected ? `\n${err.message}\n` : `fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
