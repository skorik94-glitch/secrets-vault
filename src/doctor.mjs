#!/usr/bin/env node
// hush doctor — preflight check of prerequisites before you run things.

import { spawnSync } from "node:child_process";

function cmdOk(cmd, args = ["--version"]) {
  try {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function gatherChecks(env = process.env) {
  const nodeMajor = parseInt(process.versions.node, 10);
  const hasInfisical = !!(env.INFISICAL_CLIENT_ID && env.INFISICAL_CLIENT_SECRET && env.INFISICAL_PROJECT_ID);
  return [
    { name: "Node >= 20", ok: nodeMajor >= 20, required: true, detail: `v${process.versions.node}` },
    { name: "git", ok: cmdOk("git"), required: true, detail: "leak audit (tracked/ignored)" },
    { name: "sqlite3", ok: cmdOk("sqlite3"), required: true, detail: "browser history discovery" },
    { name: "swift (Touch ID)", ok: cmdOk("swift"), required: false, detail: "biometric reveal gate; without it reveal safely denies" },
    { name: "Infisical creds", ok: hasInfisical, required: false, detail: "live vault backend; without it the MCP is report-backed" },
  ];
}

export function formatDoctor(checks) {
  const L = ["hush doctor", ""];
  for (const c of checks) {
    const mark = c.ok ? "OK  " : c.required ? "MISS" : "opt ";
    L.push(`  [${mark}] ${c.name} — ${c.detail}`);
  }
  const missingReq = checks.filter((c) => c.required && !c.ok);
  L.push("");
  L.push(
    missingReq.length
      ? `  NOT READY — missing required: ${missingReq.map((c) => c.name).join(", ")}`
      : "  READY — core prerequisites present. (Optional items unlock extra features.)",
  );
  return L.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("doctor.mjs")) {
  const checks = gatherChecks();
  process.stdout.write(formatDoctor(checks) + "\n");
  process.exit(checks.some((c) => c.required && !c.ok) ? 1 : 0);
}
