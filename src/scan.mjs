// Orchestrates the inventory scan: walk -> classify -> map projects -> audit leaks.
// Records WHERE secrets are and WHAT they are. Never stores secret values —
// content matches are reduced to a rule id + line + non-reversible fingerprint.

import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { walkFiles } from "./walk.mjs";
import {
  buildContext,
  classifyByName,
  classifyByContent,
  looksBinary,
  topSeverity,
} from "./classify.mjs";
import { auditGitForFiles } from "./git.mjs";
import {
  PROJECT_MARKERS,
  PROJECT_MARKER_SUFFIXES,
  maxSeverity,
} from "./patterns.mjs";

const READ_CAP = 32 * 1024; // bytes read per file for content sniffing

// Extensions worth sniffing even without a filename hit.
const SNIFFABLE_EXT = new Set([
  "env", "json", "yml", "yaml", "txt", "conf", "cfg", "ini", "properties",
  "sh", "zsh", "bash", "fish", "ts", "js", "mjs", "cjs", "py", "rb", "go",
  "tfvars", "toml", "xml", "plist", "pem", "key", "crt", "cert", "asc", "env.local",
]);

// Types for which lax file permissions are themselves a finding.
const PERM_SENSITIVE = new Set([
  "ssh_key", "private_key", "p8", "p12", "env", "api_key",
  "password", "service_account_json", "keystore", "token_store",
]);

const uniq = (arr) => [...new Set(arr)];

function shouldSniff(ctx, hasNameHit, size) {
  if (hasNameHit) return true;
  if (SNIFFABLE_EXT.has(ctx.ext)) return true;
  if (ctx.ext === "" && size <= READ_CAP) return true; // dotfiles / extensionless configs
  return false;
}

/** Project-root detection, memoized per directory. */
function makeProjectFinder(boundary) {
  const markerCache = new Map();
  const rootCache = new Map();

  function dirHasMarker(dir) {
    if (markerCache.has(dir)) return markerCache.get(dir);
    let has = PROJECT_MARKERS.some((m) => existsSync(path.join(dir, m)));
    if (!has && PROJECT_MARKER_SUFFIXES.length) {
      try {
        has = readdirSync(dir).some((n) =>
          PROJECT_MARKER_SUFFIXES.some((s) => n.endsWith(s)),
        );
      } catch {
        has = false;
      }
    }
    markerCache.set(dir, has);
    return has;
  }

  return function findProjectRoot(startDir) {
    if (rootCache.has(startDir)) return rootCache.get(startDir);
    const chain = [];
    let dir = startDir;
    let found = null;
    while (true) {
      chain.push(dir);
      if (dirHasMarker(dir)) {
        found = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir || dir === boundary) break; // fs root or above scan root
      dir = parent;
    }
    for (const d of chain) rootCache.set(d, found);
    return found;
  };
}

/**
 * Run a scan.
 * @param {{ roots: string[], skipDirs: Set<string>, content?: boolean,
 *           maxFileSize?: number, maxDepth?: number, now?: string,
 *           onProgress?: (n: {dirs:number, files:number, hits:number}) => void }} opts
 */
export async function scan(opts) {
  const {
    roots,
    skipDirs,
    content = true,
    maxFileSize = 256 * 1024,
    maxDepth,
    now = new Date().toISOString(),
    onProgress,
  } = opts;

  const files = [];
  const errors = [];
  let dirCount = 0;
  let fileCount = 0;

  for (const root of roots) {
    for await (const full of walkFiles(root, {
      skipDirs,
      maxDepth,
      onError: (dir, err) => errors.push({ dir, error: err.code || err.message }),
      onDir: () => {
        dirCount++;
        if (onProgress && dirCount % 500 === 0) {
          onProgress({ dirs: dirCount, files: fileCount, hits: files.length });
        }
      },
    })) {
      fileCount++;
      let stat;
      try {
        stat = await fs.lstat(full);
      } catch (err) {
        errors.push({ dir: full, error: err.code || err.message });
        continue;
      }

      const ctx = buildContext(full, root);
      const nameDet = classifyByName(ctx);

      let contentDet = [];
      if (content && stat.size <= maxFileSize && shouldSniff(ctx, nameDet.length > 0, stat.size)) {
        try {
          const fh = await fs.open(full, "r");
          try {
            const buf = Buffer.alloc(Math.min(stat.size, READ_CAP));
            const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
            const slice = buf.subarray(0, bytesRead);
            if (!looksBinary(slice)) {
              contentDet = classifyByContent(slice.toString("utf8"));
            }
          } finally {
            await fh.close();
          }
        } catch (err) {
          errors.push({ dir: full, error: err.code || err.message });
        }
      }

      const detections = [...nameDet, ...contentDet];
      if (detections.length === 0) continue;

      const mode = stat.mode & 0o777;
      files.push({
        path: full,
        rel: ctx.rel,
        size: stat.size,
        mode: mode.toString(8).padStart(3, "0"),
        groupOtherReadable: (mode & 0o077) !== 0,
        severity: topSeverity(detections),
        services: uniq(detections.map((d) => d.service)),
        types: uniq(detections.map((d) => d.type)),
        fingerprints: uniq(contentDet.map((d) => d.fingerprint).filter(Boolean)),
        detections,
      });
    }
  }

  // Map each finding to its nearest enclosing project.
  const findProject = makeProjectFinder(roots.length === 1 ? path.dirname(roots[0]) : null);
  for (const f of files) f.project = findProject(path.dirname(f.path));

  // Git leak audit (batched per repo).
  const gitInfo = await auditGitForFiles(files.map((f) => f.path));
  for (const f of files) {
    const g = gitInfo.get(f.path) || { inRepo: false, tracked: false, ignored: false, repoRoot: null };
    f.git = g;
    f.flags = [];
    if (g.tracked) {
      f.flags.push("committed-to-git");
      f.severity = maxSeverity(f.severity, "critical");
    } else if (g.inRepo && !g.ignored) {
      f.flags.push("untracked-not-gitignored");
      f.severity = maxSeverity(f.severity, "medium");
    }
    if (f.groupOtherReadable && f.types.some((t) => PERM_SENSITIVE.has(t))) {
      f.flags.push("group-or-world-readable");
      const bump = f.types.includes("ssh_key") || f.types.includes("private_key") ? "critical" : "high";
      f.severity = maxSeverity(f.severity, bump);
    }
  }

  return buildReport({ now, roots, files, errors, dirCount, fileCount });
}

function buildReport({ now, roots, files, errors, dirCount, fileCount }) {
  const bySeverity = {};
  const byService = {};
  for (const f of files) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    for (const s of f.services) byService[s] = (byService[s] || 0) + 1;
  }

  const leaks = files
    .filter((f) => f.flags.length > 0)
    .sort((a, b) => sevValue(b.severity) - sevValue(a.severity));

  // Duplicate credentials: same fingerprint across >1 file.
  const fpMap = new Map();
  for (const f of files) {
    for (const fp of f.fingerprints) {
      if (!fpMap.has(fp)) fpMap.set(fp, []);
      fpMap.get(fp).push(f.path);
    }
  }
  const duplicates = [...fpMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([fingerprint, paths]) => ({ fingerprint, count: paths.length, paths }));

  // Group by project.
  const projMap = new Map();
  for (const f of files) {
    const key = f.project || "(loose / not in a project)";
    if (!projMap.has(key)) projMap.set(key, []);
    projMap.get(key).push(f.path);
  }
  const projects = [...projMap.entries()]
    .map(([root, paths]) => ({ root, count: paths.length, paths }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: now,
    roots,
    scanned: { dirs: dirCount, files: fileCount },
    stats: { total: files.length, bySeverity, byService },
    leaks,
    duplicates,
    projects,
    files,
    errors,
  };
}

const SEV_ORDER = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
function sevValue(s) {
  return SEV_ORDER[s] ?? 0;
}
