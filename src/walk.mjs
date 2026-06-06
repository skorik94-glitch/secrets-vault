// Read-only, depth-first directory walk.
// - never follows symlinks (avoids loops and escaping the scan root)
// - skips directories whose basename is in `skipDirs`
// - reports unreadable directories via onError instead of throwing

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Async generator yielding absolute file paths under `root`.
 * @param {string} root
 * @param {{ skipDirs: Set<string>, maxDepth?: number,
 *           onError?: (dir: string, err: Error) => void,
 *           onDir?: (dir: string) => void }} opts
 */
export async function* walkFiles(root, opts) {
  const { skipDirs, maxDepth, onError, onDir } = opts;

  async function* walkDir(dir, depth) {
    if (maxDepth != null && depth > maxDepth) return;
    let handle;
    try {
      handle = await fs.opendir(dir);
    } catch (err) {
      onError?.(dir, err);
      return;
    }
    onDir?.(dir);
    for await (const ent of handle) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue; // do not follow links
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        yield* walkDir(full, depth + 1);
      } else if (ent.isFile()) {
        yield full;
      }
    }
  }

  yield* walkDir(root, 0);
}
