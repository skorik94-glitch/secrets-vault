#!/usr/bin/env node
// secrets-onboard — plan/apply import of discovered secrets into Infisical.
// DRY-RUN by default (shows the plan, no values, no writes).
// --apply writes to your vault (consent + machine-identity creds required).

import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPlan, toPublicPlan } from "./onboard.mjs";
import { infisicalClient } from "./infisical.mjs";
import { ensureConsent } from "./consent.mjs";

const HELP = `secrets-onboard — import discovered secrets into Infisical

Usage:
  node src/onboard-cli.mjs --from <report.json> [options]

Options:
  --from <report.json>   Stage-1 scan report to onboard (required)
  --env <slug>           Target environment slug (default: dev)
  --apply                Actually write to Infisical (default: dry-run)
  --update               Overwrite existing secrets (PATCH) instead of skipping
  --api-url <url>        Infisical API URL (or INFISICAL_API_URL; default cloud)
  --out <file>           Plan JSON path (default: .secrets-inventory/import-plan-<ts>.json)
  --json                 Print plan JSON to stdout
  --yes                  Consent (required non-interactively, esp. for --apply)
  --quiet                Suppress progress
  -h, --help             Show this help

Apply needs a machine identity via env vars:
  INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID

Dry-run shows WHERE each secret would go and dedup decisions — never values.`;

function parseArgs(argv) {
  const o = { from: null, env: "dev", apply: false, update: false, apiUrl: null, out: null, json: false, yes: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--from") o.from = path.resolve(argv[++i]);
    else if (a === "--env") o.env = argv[++i];
    else if (a === "--apply") o.apply = true;
    else if (a === "--update") o.update = true;
    else if (a === "--api-url") o.apiUrl = argv[++i];
    else if (a === "--out") o.out = path.resolve(argv[++i]);
    else if (a === "--json") o.json = true;
    else if (a === "--yes") o.yes = true;
    else if (a === "--quiet") o.quiet = true;
    else { process.stderr.write(`unknown option: ${a}\n`); o.help = true; }
  }
  return o;
}

const tsSlug = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");

function formatPlan(plan) {
  const L = [];
  L.push("=".repeat(72));
  L.push("  IMPORT PLAN — discovered secrets -> Infisical (dry-run)");
  L.push("=".repeat(72));
  L.push(`  env       : ${plan.env}`);
  L.push(`  secrets   : ${plan.stats.total}  (shared: ${plan.stats.shared}, app: ${plan.stats.app})`);
  L.push(`  deduped   : ${plan.stats.dedupedDuplicates} duplicate value(s) collapsed`);
  L.push(`  manual    : ${plan.stats.manual} (content-only — review by hand)`);
  L.push("");

  const byPath = new Map();
  for (const s of plan.secrets) {
    if (!byPath.has(s.targetPath)) byPath.set(s.targetPath, []);
    byPath.get(s.targetPath).push(s);
  }
  for (const [p, list] of [...byPath].sort()) {
    L.push(`  ${p}`);
    for (const s of list) {
      const ml = s.multiline ? "multiline " : "";
      const used = s.usedBy.length ? `  used by: ${s.usedBy.join(", ")}` : "";
      L.push(`    ${s.secretName}  [${s.action}/${s.kind}]  ${ml}${s.valueLength}b${used}`);
      if (s.collisionRenamed) L.push(`        (renamed to avoid a name collision)`);
    }
  }
  L.push("");

  if (plan.manual.length) {
    L.push("-".repeat(72));
    L.push("  MANUAL (content-only secrets — name/scope by hand, then add to vault):");
    L.push("-".repeat(72));
    for (const m of plan.manual.slice(0, 25)) L.push(`    ${m.path}  (${m.services?.join("/")})`);
    L.push("");
  }
  if (plan.errors.length) L.push(`  ${plan.errors.length} file(s) unreadable (see JSON).`);

  L.push("!".repeat(72));
  L.push("  Dry-run: nothing was written. Values are NOT shown here.");
  L.push("  Re-run with --apply (+ machine-identity env vars) to write to Infisical.");
  L.push("!".repeat(72));
  return L.join("\n");
}

async function apply(plan, o, log) {
  const apiUrl = o.apiUrl || process.env.INFISICAL_API_URL || "https://app.infisical.com";
  const clientId = process.env.INFISICAL_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET;
  const projectId = process.env.INFISICAL_PROJECT_ID;
  if (!clientId || !clientSecret || !projectId) {
    throw new Error(
      "apply needs INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID in the environment.",
    );
  }

  await ensureConsent({
    action: `WRITE ${plan.secrets.length} secret(s) into Infisical at ${apiUrl} (project ${projectId}, env ${plan.env})`,
    scope: ["reads secret values from local files", "creates folders + secrets in YOUR vault"],
    yes: o.yes,
  });

  const client = infisicalClient({ apiUrl, clientId, clientSecret, projectId, environment: plan.env });
  log("authenticating to Infisical…");
  await client.login();

  const res = { created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };
  for (const s of plan.secrets) {
    try {
      await client.ensureFolder(s.targetPath);
      const exists = await client.secretExists(s.secretName, s.targetPath);
      if (exists && !o.update) {
        res.skipped++;
        continue;
      }
      await client.setSecret({
        name: s.secretName,
        value: s.value,
        secretPath: s.targetPath,
        multiline: s.multiline,
        comment: `imported by secrets-onboard (${s.action}, used by: ${s.usedBy.join(", ") || "—"})`,
        update: exists,
      });
      exists ? res.updated++ : res.created++;
      log(`  ${exists ? "updated" : "created"} ${s.targetPath}/${s.secretName}`);
    } catch (e) {
      res.failed++;
      res.failures.push({ secret: `${s.targetPath}/${s.secretName}`, error: e.message });
    }
  }
  return res;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return void process.stdout.write(HELP + "\n");
  const log = o.quiet ? () => {} : (m) => process.stderr.write(m + "\n");

  if (!o.from) throw new Error("--from <report.json> is required (run `npm run scan` first).");
  const report = JSON.parse(readFileSync(o.from, "utf8"));

  const result = await buildPlan(report, { env: o.env });
  const pub = toPublicPlan(result);

  if (o.json) process.stdout.write(JSON.stringify(pub, null, 2) + "\n");
  else {
    const outPath = o.out || path.resolve(".secrets-inventory", `import-plan-${tsSlug(new Date())}.json`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(pub, null, 2), { mode: 0o600 });
    process.stdout.write(formatPlan(pub) + "\n");
    process.stdout.write(`\n  Plan JSON: ${outPath}\n`);
  }

  if (o.apply) {
    const res = await apply(result, o, log);
    process.stdout.write(
      `\n  APPLIED: created ${res.created}, updated ${res.updated}, skipped ${res.skipped}, failed ${res.failed}\n`,
    );
    for (const f of res.failures) process.stdout.write(`    FAIL ${f.secret}: ${f.error}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(err?.expected ? `\n${err.message}\n` : `fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
