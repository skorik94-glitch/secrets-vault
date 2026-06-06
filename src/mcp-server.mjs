#!/usr/bin/env node
// secrets-vault MCP server (stdio, reference-only). Exposes the vault to an
// MCP client (e.g. Claude Code). Metadata tools never return secret values;
// reveal/materialize_file are gated by biometric approval and audited.
//
// Backend: Infisical (if INFISICAL_* env present) else local scan reports.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { reportVault, infisicalVault } from "./vault.mjs";
import { infisicalClient } from "./infisical.mjs";
import { auditLogger } from "./audit.mjs";
import { requireApproval } from "./biometric.mjs";
import { createMcpServer } from "./mcp.mjs";
import { startStdio } from "./jsonrpc.mjs";

const PROFILES = {
  expo: ["supabase", "google", "apple", "expo"],
  "next-web": ["supabase", "vercel", "stripe"],
  "node-api": ["database", "stripe", "sentry"],
  mobile: ["apple", "google", "supabase"],
};

/** Build the MCP tool set against a vault + audit log + approval gate (+ optional Infisical client). */
export function buildTools({ vault, audit, approver, client }) {
  return [
    {
      name: "list_services",
      description: "List services you have credentials for (names only, no values).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ services: await vault.services() }),
    },
    {
      name: "list_credentials",
      description: "List credential METADATA (name, path, type, service). Never returns secret values.",
      inputSchema: { type: "object", properties: { service: { type: "string" } } },
      handler: async ({ service }) => ({ credentials: await vault.credentials(service) }),
    },
    {
      name: "find_projects",
      description: "Find projects on disk and which credentials they use.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      handler: async ({ query }) => ({ projects: await vault.projects(query) }),
    },
    {
      name: "describe_project",
      description: "Describe one project's credentials.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async ({ path: p }) => vault.describeProject(p),
    },
    {
      name: "suggest_for_new_project",
      description: "Suggest the credential set a new project of a given kind usually needs.",
      inputSchema: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
      handler: async ({ kind }) => {
        const needs = PROFILES[kind] || [];
        const have = new Set(await vault.services());
        return {
          kind,
          knownKinds: Object.keys(PROFILES),
          needs,
          youHave: needs.filter((s) => have.has(s)),
          missing: needs.filter((s) => !have.has(s)),
        };
      },
    },
    {
      name: "provision",
      description:
        "Provision a new project to reuse existing access: link to Infisical + import shared credentials. Never writes secret values.",
      inputSchema: {
        type: "object",
        properties: {
          project_path: { type: "string" },
          services: { type: "array", items: { type: "string" } },
          apply: { type: "boolean" },
        },
        required: ["project_path"],
      },
      handler: async ({ project_path, services = [], apply = false }) => {
        const projectId = process.env.INFISICAL_PROJECT_ID || "<set INFISICAL_PROJECT_ID>";
        const appName = path.basename(project_path);
        const appFolder = `/apps/${appName}`;
        const importFrom = services.map((s) => `/shared/${s}`);
        const plan = {
          project: project_path,
          appFolder,
          importFrom,
          infisicalJson: { workspaceId: projectId, defaultEnvironment: "dev" },
          run: "infisical run -- <your dev command>",
        };
        if (!apply) {
          return { dryRun: true, plan, note: "re-run with apply:true to write link files and wire imports (no secret values)" };
        }

        // 1) local link files (value-free)
        mkdirSync(project_path, { recursive: true });
        writeFileSync(path.join(project_path, "infisical.json"), JSON.stringify(plan.infisicalJson, null, 2));
        const md =
          `# Vault-managed secrets\n\nLinked to Infisical project \`${projectId}\`, folder \`${appFolder}\`.\n\n` +
          `Shared credentials imported from:\n${importFrom.map((s) => `- ${s}`).join("\n") || "- (none)"}\n\n` +
          `Run with injected secrets:\n\n    ${plan.run}\n\nNo secret values are stored in this repo.\n`;
        writeFileSync(path.join(project_path, "VAULT.md"), md);

        // 2) wire imports in Infisical (reuse the same access)
        const wired = [];
        if (client) {
          await client.ensureFolder(appFolder);
          for (const src of importFrom) {
            await client.createSecretImport(appFolder, src);
            wired.push(src);
          }
        }
        await audit.record({ tool: "provision", target: project_path, imports: wired, result: "applied" });
        return { applied: true, wrote: ["infisical.json", "VAULT.md"], wiredImports: wired, plan };
      },
    },
    {
      name: "reveal",
      description:
        "Reveal one credential value. GATED by biometric approval and audited. Restricted to inventoried/vault credentials.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, key: { type: "string" } },
        required: ["path"],
      },
      handler: async ({ path: p, key }) => {
        const reason = `Reveal credential: ${path.basename(p)}${key ? ` [${key}]` : ""}`;
        const approved = await requireApproval(reason, { approver });
        await audit.record({ tool: "reveal", target: p, key: key || null, result: approved ? "approved" : "denied" });
        if (!approved) throw new Error("reveal denied (biometric approval failed or unavailable)");
        const value = await vault.reveal({ path: p, key });
        return { path: p, key: key || null, value };
      },
    },
    {
      name: "materialize_file",
      description:
        "Write one credential's value to a file on disk (e.g. an SSH key or .p8). GATED by biometric approval and audited.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          key: { type: "string" },
          dest: { type: "string" },
          mode: { type: "string", description: "octal file mode, default 600" },
        },
        required: ["dest"],
      },
      handler: async ({ path: p, key, dest, mode }) => {
        const reason = `Materialize credential -> ${dest}`;
        const approved = await requireApproval(reason, { approver });
        await audit.record({
          tool: "materialize_file",
          target: dest,
          source: p || null,
          key: key || null,
          result: approved ? "approved" : "denied",
        });
        if (!approved) throw new Error("materialize denied (biometric approval failed or unavailable)");
        const value = await vault.reveal({ path: p, key });
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, value, { mode: mode ? parseInt(mode, 8) : 0o600 });
        return { wrote: dest, bytes: value.length }; // never echoes the value
      },
    },
    {
      name: "scan_for_leaks",
      description: "List credentials flagged as leaked/exposed (committed to git, world-readable).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({ leaks: await vault.leaks() }),
    },
    {
      name: "audit_log",
      description: "Read recent sensitive-operation audit entries.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
      handler: async ({ limit }) => ({ entries: await audit.read(limit) }),
    },
  ];
}

// ---- entry point ---------------------------------------------------------

function loadJSON(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function latestReport(dir, prefix) {
  try {
    const matches = readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith(".json")).sort();
    return matches.length ? path.join(dir, matches[matches.length - 1]) : null;
  } catch {
    return null;
  }
}

async function main() {
  const dir = process.env.SECRETS_VAULT_DIR || path.resolve(".secrets-inventory");
  const scanPath = process.env.SECRETS_VAULT_SCAN_REPORT || latestReport(dir, "inventory-report-");
  const discPath = process.env.SECRETS_VAULT_DISCOVER_REPORT || latestReport(dir, "service-surface-");
  const scan = (scanPath && loadJSON(scanPath)) || {};
  const discover = (discPath && loadJSON(discPath)) || {};

  const { INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID } = process.env;
  let vault;
  let client = null;
  let backend = "report";
  if (INFISICAL_CLIENT_ID && INFISICAL_CLIENT_SECRET && INFISICAL_PROJECT_ID) {
    client = infisicalClient({
      apiUrl: process.env.INFISICAL_API_URL || "https://app.infisical.com",
      clientId: INFISICAL_CLIENT_ID,
      clientSecret: INFISICAL_CLIENT_SECRET,
      projectId: INFISICAL_PROJECT_ID,
      environment: process.env.INFISICAL_ENV || "dev",
    });
    await client.login();
    vault = infisicalVault({ client, scan });
    backend = "infisical";
  } else {
    vault = reportVault({ scan, discover });
  }

  const audit = auditLogger(path.join(dir, "audit.jsonl"));
  const tools = buildTools({ vault, audit, client });
  const { handle } = createMcpServer({ serverInfo: { name: "secrets-vault", version: "0.1.0" }, tools });

  process.stderr.write(
    `secrets-vault MCP up · backend:${backend} · scan:${scanPath ? path.basename(scanPath) : "none"} · ` +
      `${(scan.files || []).length} local credentials\n`,
  );
  startStdio(handle);
}

if (process.argv[1] && process.argv[1].endsWith("mcp-server.mjs")) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err?.stack || err}\n`);
    process.exit(1);
  });
}
