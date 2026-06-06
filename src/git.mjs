// Git leak-audit helpers. Determines, for a set of files, whether each is:
//   - inside a git repo
//   - currently tracked (committed) -> a real leak
//   - covered by .gitignore        -> protected
// Uses the `git` CLI; degrades gracefully if git is missing or a path errors.

import { spawn } from "node:child_process";
import path from "node:path";

/** Run git, resolving with {code, stdout, stderr} even on non-zero exit. */
function git(cwd, args, input) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn("git", ["-C", cwd, ...args]);
    } catch {
      resolve({ code: -1, stdout: "", stderr: "spawn-failed" });
      return;
    }
    let out = "";
    let err = "";
    p.on("error", () => resolve({ code: -1, stdout: "", stderr: "spawn-failed" }));
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    if (input != null) p.stdin.write(input);
    p.stdin.end();
  });
}

/**
 * Audit a list of absolute file paths.
 * @returns {Promise<Map<string, {inRepo:boolean, repoRoot:string|null, tracked:boolean, ignored:boolean}>>}
 */
export async function auditGitForFiles(files) {
  const result = new Map();
  const repoRootCache = new Map();

  async function repoRootOf(dir) {
    if (repoRootCache.has(dir)) return repoRootCache.get(dir);
    const { code, stdout } = await git(dir, ["rev-parse", "--show-toplevel"]);
    const root = code === 0 ? stdout.trim() : null;
    repoRootCache.set(dir, root);
    return root;
  }

  // Group files by their repo root.
  const byRepo = new Map(); // repoRoot -> [absPaths]
  for (const file of files) {
    const root = await repoRootOf(path.dirname(file));
    if (!root) {
      result.set(file, { inRepo: false, repoRoot: null, tracked: false, ignored: false });
      continue;
    }
    if (!byRepo.has(root)) byRepo.set(root, []);
    byRepo.get(root).push(file);
  }

  for (const [root, repoFiles] of byRepo) {
    // Tracked set: all files git knows about, repo-relative.
    const tracked = new Set();
    const ls = await git(root, ["ls-files", "-z"]);
    if (ls.code === 0) {
      for (const rel of ls.stdout.split("\0")) if (rel) tracked.add(rel);
    }

    // Ignored set: feed candidate rel paths to check-ignore via stdin.
    const rels = repoFiles.map((f) => path.relative(root, f));
    const ignored = new Set();
    const ci = await git(root, ["check-ignore", "-z", "--stdin"], rels.join("\0") + "\0");
    // exit 0 => some ignored, exit 1 => none ignored, other => error (treat as none)
    if (ci.code === 0) {
      for (const rel of ci.stdout.split("\0")) if (rel) ignored.add(rel);
    }

    for (const file of repoFiles) {
      const rel = path.relative(root, file);
      result.set(file, {
        inRepo: true,
        repoRoot: root,
        tracked: tracked.has(rel),
        ignored: ignored.has(rel),
      });
    }
  }

  return result;
}
