// Fractal documentation: load the RIGHT local context for a path (nearest
// CLAUDE.md / AGENTS.md from repo root down to the file's folder), and map where
// docs are missing. Keeps the agent's context local instead of one global blob.
// Zero dependencies.

import fs from "node:fs";
import path from "node:path";

const DOC_NAMES = ["CLAUDE.md", "AGENTS.md"];
const SKIP = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", "vendor",
  "__pycache__", ".venv", "venv", ".next", ".turbo", "Pods", "DerivedData",
  ".agent", ".secrets-inventory", ".hush",
]);

/**
 * Stacked local context for `target` (a file or dir), global -> local.
 * @returns {{target:string, docs:Array<{level:string,file:string,content:string}>}}
 */
export function localContext(target, project) {
  const root = path.resolve(project);
  let dir = path.resolve(project, target);
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir); // target doesn't exist yet — use its parent
  }

  // Build the ancestor chain root -> dir.
  const chain = [];
  let cur = dir;
  while (cur.startsWith(root)) {
    chain.unshift(cur);
    if (cur === root) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  const docs = [];
  for (const d of chain) {
    for (const name of DOC_NAMES) {
      const f = path.join(d, name);
      try {
        docs.push({ level: path.relative(root, d) || ".", file: f, content: fs.readFileSync(f, "utf8") });
      } catch {
        /* no doc at this level */
      }
    }
  }
  return { target: path.relative(root, path.resolve(project, target)) || ".", docs };
}

/** Map which directories have fractal docs vs not (surface gaps). */
export function docMap(project, { maxDepth = 4 } = {}) {
  const root = path.resolve(project);
  const withDocs = [];
  const without = [];
  (function walk(dir, depth) {
    if (depth > maxDepth) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasDoc = ents.some((e) => e.isFile() && DOC_NAMES.includes(e.name));
    (hasDoc ? withDocs : without).push(path.relative(root, dir) || ".");
    for (const e of ents) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  })(root, 0);
  const total = withDocs.length + without.length || 1;
  return { withDocs, without, coverage: Math.round((withDocs.length / total) * 100) / 100 };
}
