#!/usr/bin/env node
// secrets-inventory — read-only scanner (Stage 1 of the Secrets Vault MCP).
// Inventories secret-bearing files, maps them to projects, and audits leaks.
// No writes outside the chosen output file. No network.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scan } from "./scan.mjs";
import { DEFAULT_SKIP_DIRS } from "./patterns.mjs";
import { buildSummaryText } from "./report.mjs";
import { ensureConsent } from "./consent.mjs";
import { vaultDir } from "./paths.mjs";

const HELP = `secrets-inventory — read-only secret/credential scanner

Usage:
  node src/cli.mjs [options]

Options:
  --root <path>          Root to scan (repeatable). Default: $HOME
  --out <file>           JSON report path. Default: .secrets-inventory/inventory-report-<ts>.json
  --json                 Print full JSON to stdout instead of writing a file
  --no-content           Skip content sniffing (filename rules only; faster)
  --max-file-size <n>    Max file size (bytes) to sniff. Default: 262144
  --max-depth <n>        Max directory depth
  --add-skip <name>      Extra directory basename to skip (repeatable)
  --include-skipped      Do NOT skip the default noise dirs (slow; use with care)
  --quiet                Suppress progress output
  --yes                  Consent to read sensitive local data (required non-interactively)
  -h, --help             Show this help

The report records WHERE secrets are and WHAT they are — never the values.
Output files are written 0600 and are gitignored.`;

function parseArgs(argv) {
  const o = {
    roots: [],
    out: null,
    json: false,
    content: true,
    maxFileSize: 256 * 1024,
    maxDepth: undefined,
    addSkip: [],
    includeSkipped: false,
    quiet: false,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help": o.help = true; break;
      case "--root": o.roots.push(path.resolve(argv[++i])); break;
      case "--out": o.out = path.resolve(argv[++i]); break;
      case "--json": o.json = true; break;
      case "--no-content": o.content = false; break;
      case "--max-file-size": o.maxFileSize = parseInt(argv[++i], 10); break;
      case "--max-depth": o.maxDepth = parseInt(argv[++i], 10); break;
      case "--add-skip": o.addSkip.push(argv[++i]); break;
      case "--include-skipped": o.includeSkipped = true; break;
      case "--quiet": o.quiet = true; break;
      case "--yes": o.yes = true; break;
      default:
        process.stderr.write(`unknown option: ${a}\n`);
        o.help = true;
    }
  }
  return o;
}

function tsSlug(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    process.stdout.write(HELP + "\n");
    return;
  }

  const roots = o.roots.length ? o.roots : [os.homedir()];
  const skipDirs = o.includeSkipped
    ? new Set(o.addSkip)
    : new Set([...DEFAULT_SKIP_DIRS, ".secrets-inventory", ".secrets-vault", ...o.addSkip]);

  await ensureConsent({
    action: "scan local files for secrets/credentials",
    scope: roots.map((r) => `read files under ${r}`),
    yes: o.yes,
  });

  const startedAt = new Date();
  if (!o.quiet) {
    process.stderr.write(`Scanning ${roots.join(", ")} …\n`);
  }

  const report = await scan({
    roots,
    skipDirs,
    content: o.content,
    maxFileSize: o.maxFileSize,
    maxDepth: o.maxDepth,
    now: startedAt.toISOString(),
    onProgress: o.quiet
      ? undefined
      : (p) => process.stderr.write(`\r  ${p.dirs} dirs · ${p.files} files · ${p.hits} hits   `),
  });
  if (!o.quiet) process.stderr.write("\n");

  if (o.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.stderr.write("\n" + buildSummaryText(report) + "\n");
    return;
  }

  const outPath = o.out || path.join(vaultDir(), `inventory-report-${tsSlug(startedAt)}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), { mode: 0o600 });

  process.stdout.write(buildSummaryText(report) + "\n");
  process.stdout.write(`\n  Full JSON report: ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(err?.expected ? `\n${err.message}\n` : `fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
