// Stage 2 planner: turn a Stage-1 scan report into an Infisical import plan.
// - .env* files  -> one secret per KEY
// - key files (ssh/.p8/.p12/json/...) -> one secret holding the file content
// - content-only hits in source files -> flagged for MANUAL review (not auto-imported)
//
// Layout: a value seen in >1 project (or globally) -> /shared/<service>; a value
// unique to one project -> /apps/<project>. Dedup is by value fingerprint, so the
// same credential reused across projects is stored ONCE (blast-radius win).
//
// Values are read only to plan/apply; toPublicPlan() strips them for display/serialization.

import fs from "node:fs/promises";
import path from "node:path";
import { fingerprint } from "./classify.mjs";

const WHOLE_FILE_VIA_NAME = true; // non-env files detected by a NAME rule -> file secret

const isEnvFile = (file) => {
  const base = path.basename(file.path);
  return file.types?.includes("env") || base.endsWith(".env") || /^\.env(\.|$)/.test(base);
};

const KEY_SERVICE = [
  [/^SUPABASE/i, "supabase"], [/^(GOOGLE|GCP|GCLOUD)/i, "google"], [/^FIREBASE/i, "firebase"],
  [/^(AWS|S3)/i, "aws"], [/^STRIPE/i, "stripe"], [/^OPENAI/i, "openai"], [/^ANTHROPIC/i, "anthropic"],
  [/^(GITHUB|GH)_/i, "github"], [/^VERCEL/i, "vercel"], [/^(EXPO|EAS)/i, "expo"],
  [/^(APPLE|ASC|APP_STORE)/i, "apple"], [/^SLACK/i, "slack"], [/^TWILIO/i, "twilio"],
  [/^(SENDGRID|RESEND|POSTMARK|MAILGUN)/i, "email"], [/^SENTRY/i, "sentry"],
  [/^(CLOUDFLARE|CF)_/i, "cloudflare"], [/^(DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS)_/i, "database"],
];
const inferServiceFromKey = (key) => KEY_SERVICE.find(([re]) => re.test(key))?.[1] || "misc";
const fileService = (file) =>
  (file.services || []).find((s) => s !== "generic" && s !== "cert") || file.services?.[0] || "misc";

const sanitize = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();

function deriveFileSecretName(file, projectName) {
  const base = path.basename(file.path);
  const stem = base.replace(/\.[^.]+$/, "");
  if (file.types?.includes("ssh_key")) return `SSH_PRIVATE_KEY_${sanitize(stem)}`;
  if (file.types?.includes("p8")) return `APPLE_AUTHKEY_${sanitize(stem)}`;
  if (file.types?.includes("service_account_json")) return `GCP_SERVICE_ACCOUNT_${sanitize(projectName || stem)}`;
  if (file.types?.includes("p12")) return `CERT_P12_${sanitize(stem)}`;
  if (file.types?.includes("private_key")) return `PRIVATE_KEY_${sanitize(stem)}`;
  if (base === ".npmrc") return "NPMRC_FILE";
  if (base === ".netrc") return "NETRC_FILE";
  if (base === ".git-credentials") return "GIT_CREDENTIALS_FILE";
  if (/\/\.aws\/credentials$/.test(file.path)) return "AWS_CREDENTIALS_FILE";
  return `${sanitize(fileService(file))}_${sanitize(base)}`;
}

const projName = (p) => (p ? path.basename(p) : null);

/**
 * Build an import plan (with values in memory).
 * @returns {Promise<{env:string, secrets:Array, manual:Array, errors:Array, stats:object}>}
 */
export async function buildPlan(report, { env = "dev" } = {}) {
  const candidates = []; // {project, service, kind, key, value, file}
  const manual = [];
  const errors = [];

  for (const file of report.files || []) {
    const project = projName(file.project);
    try {
      if (isEnvFile(file)) {
        const text = await fs.readFile(file.path, "utf8");
        const { parseEnv } = await import("./envparse.mjs");
        for (const { key, value } of parseEnv(text)) {
          candidates.push({ project, service: inferServiceFromKey(key), kind: "env-key", key, value, file: file.path });
        }
      } else if (WHOLE_FILE_VIA_NAME && (file.detections || []).some((d) => d.via === "name")) {
        const value = await fs.readFile(file.path, "utf8");
        candidates.push({
          project,
          service: fileService(file),
          kind: "file",
          key: deriveFileSecretName(file, project),
          value,
          file: file.path,
        });
      } else {
        manual.push({ path: file.path, services: file.services, reason: "content-only detection — review and move manually" });
      }
    } catch (e) {
      errors.push({ path: file.path, error: e.code || e.message });
    }
  }

  // Group by value fingerprint (dedup identical credentials).
  const groups = new Map();
  for (const c of candidates) {
    const fp = fingerprint(c.value);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(c);
  }

  const secrets = [];
  let deduped = 0;
  for (const [fp, group] of groups) {
    if (group.length > 1) deduped += group.length - 1;
    const rep = group[0];
    const appProjects = [...new Set(group.map((c) => c.project).filter(Boolean))];
    const hasGlobal = group.some((c) => c.project === null);
    const shared = !(appProjects.length === 1 && !hasGlobal);

    const service = rep.kind === "env-key" ? inferServiceFromKey(rep.key) : rep.service;
    const targetPath = shared ? `/shared/${service}` : `/apps/${appProjects[0]}`;
    const aliases = [...new Set(group.map((c) => c.key))];

    secrets.push({
      targetPath,
      secretName: rep.key,
      aliases: aliases.length > 1 ? aliases : undefined,
      service,
      kind: rep.kind,
      action: shared ? "shared" : "app",
      usedBy: [...appProjects, ...(hasGlobal ? ["(global)"] : [])],
      sources: [...new Set(group.map((c) => c.file))],
      fingerprint: fp,
      multiline: rep.value.includes("\n"),
      value: rep.value,
    });
  }

  // Resolve name collisions at the same path with different values.
  const seen = new Map();
  for (const s of secrets) {
    const k = `${s.targetPath}/${s.secretName}`;
    if (seen.has(k) && seen.get(k) !== s.fingerprint) {
      s.secretName = `${s.secretName}_${s.fingerprint.slice(0, 6)}`;
      s.collisionRenamed = true;
    } else {
      seen.set(k, s.fingerprint);
    }
  }

  secrets.sort((a, b) => a.targetPath.localeCompare(b.targetPath) || a.secretName.localeCompare(b.secretName));

  return {
    env,
    secrets,
    manual,
    errors,
    stats: {
      total: secrets.length,
      shared: secrets.filter((s) => s.action === "shared").length,
      app: secrets.filter((s) => s.action === "app").length,
      manual: manual.length,
      dedupedDuplicates: deduped,
    },
  };
}

/** Strip secret values for display / on-disk plan. */
export function toPublicPlan(result) {
  return {
    ...result,
    secrets: result.secrets.map(({ value, ...s }) => ({
      ...s,
      valueLength: value.length,
    })),
  };
}
