#!/usr/bin/env node
// Stop hook: a GENTLE, non-blocking nudge to consolidate when the journal has grown.
// Uses additionalContext (exit 0) — never blocks the agent from stopping, never loops.
// Self-resolving: after `consolidate` archives the journal, the count drops and the
// nudge stops. Tune via HUSH_CONSOLIDATE_THRESHOLD; disable via HUSH_NO_STOP_HOOK=1.

import { memoryStore } from "../src/memory.mjs";

async function readStdin() {
  if (process.stdin.isTTY) return "";
  return await new Promise((resolve) => {
    let d = "";
    const t = setTimeout(() => resolve(d), 250);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      resolve(d);
    });
  });
}

try {
  if (process.env.HUSH_NO_STOP_HOOK) process.exit(0);

  let project = process.env.CLAUDE_PROJECT_DIR;
  if (!project) {
    try {
      const ev = JSON.parse((await readStdin()) || "{}");
      project = ev.cwd || process.cwd();
    } catch {
      project = process.cwd();
    }
  }

  const threshold = parseInt(process.env.HUSH_CONSOLIDATE_THRESHOLD || "8", 10);
  const n = memoryStore(project).journal(10000).length;
  if (!Number.isFinite(threshold) || n < threshold) process.exit(0);

  const context =
    `You've logged ${n} memory crumbs this session without consolidating. ` +
    `At a good stopping point, call \`consolidate\` (memory "sleep") to compress them ` +
    `into the living state — so the next session starts clean and nothing is lost.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: context } }));
  process.exit(0);
} catch {
  process.exit(0); // never block stopping on a memory error
}
