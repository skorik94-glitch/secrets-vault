// Vault adapter (report-backed). Exposes metadata derived from Stage-1/1b reports
// — NEVER values, except via reveal(), which is restricted to inventoried paths.
// (An Infisical-backed adapter with the same shape is the later upgrade.)

import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "./envparse.mjs";

export function reportVault({ scan = {}, discover = {} } = {}) {
  const files = scan.files || [];
  const allowedPaths = new Set(files.map((f) => f.path)); // reveal allowlist

  return {
    services() {
      const set = new Set(Object.keys(scan.stats?.byService || {}));
      for (const s of discover.services || []) set.add(s.service);
      return [...set].sort();
    },

    credentials(service) {
      return files
        .filter((f) => !service || (f.services || []).includes(service))
        .map((f) => ({
          name: path.basename(f.path),
          path: f.path,
          services: f.services,
          types: f.types,
          severity: f.severity,
          project: f.project,
          flags: f.flags,
          fingerprints: f.fingerprints, // hashes, not values
        }));
    },

    projects(query) {
      let ps = scan.projects || [];
      if (query) {
        const q = query.toLowerCase();
        ps = ps.filter((p) => p.root && p.root.toLowerCase().includes(q));
      }
      return ps;
    },

    describeProject(p) {
      const inProj = files.filter((f) => f.project === p);
      return {
        project: p,
        count: inProj.length,
        credentials: inProj.map((f) => ({
          name: path.basename(f.path),
          path: f.path,
          services: f.services,
          types: f.types,
        })),
      };
    },

    leaks() {
      return (scan.leaks || []).map((f) => ({
        path: f.path,
        severity: f.severity,
        flags: f.flags,
        services: f.services,
        mode: f.mode,
      }));
    },

    /** The ONLY value-returning method. Restricted to inventoried paths. */
    async reveal({ path: filePath, key } = {}) {
      if (!filePath || !allowedPaths.has(filePath)) {
        throw new Error("reveal is restricted to inventoried credential paths");
      }
      const text = await fs.readFile(filePath, "utf8");
      if (key) {
        const entry = parseEnv(text).find((e) => e.key === key);
        if (!entry) throw new Error(`key not found in file: ${key}`);
        return entry.value;
      }
      return text;
    },
  };
}

/**
 * Infisical-backed vault: credentials/services/reveal come from the live vault;
 * projects/leaks still come from the local scan report (filesystem knowledge).
 * Credential listings return METADATA only — secret values are stripped here.
 */
export function infisicalVault({ client, scan = {} }) {
  const local = reportVault({ scan });

  return {
    async services() {
      const folders = await client.listFolders("/shared");
      return folders.map((f) => f.name).sort();
    },

    async credentials(service) {
      const secretPath = service ? `/shared/${service}` : "/shared";
      const secrets = await client.listSecrets(secretPath);
      // strip values — expose names/paths/types only
      return secrets.map((s) => ({
        name: s.secretKey,
        path: secretPath,
        type: s.type || "secret",
        service: service || null,
      }));
    },

    projects: (q) => local.projects(q),
    describeProject: (p) => local.describeProject(p),
    leaks: () => local.leaks(),

    /** Gated value read from the vault. `path` = secret folder, `key` = secret name. */
    async reveal({ path: secretPath, key } = {}) {
      if (!key) throw new Error("reveal from the vault needs a key (secret name) and path");
      return client.getSecret(key, secretPath || "/");
    },
  };
}
