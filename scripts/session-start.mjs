#!/usr/bin/env node
// SessionStart hook: auto-load this project's memory so the agent starts WITH context
// (no manual `recall` needed). Reads <project>/.agent/ and injects a briefing.
// Safe: read-only, fails silent (never blocks a session). Output format verified
// against the Claude Code SessionStart hook contract.

import { memoryStore } from "../src/memory.mjs";

async function readStdin() {
  if (process.stdin.isTTY) return "";
  return await new Promise((resolve) => {
    let d = "";
    const t = setTimeout(() => resolve(d), 250); // never hang if no input arrives
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      resolve(d);
    });
  });
}

function briefing(r) {
  const L = [];
  if (r.state && r.state.trim()) L.push(r.state.trim(), "");
  if (r.decisions?.length) {
    L.push("## Decisions on record");
    for (const d of r.decisions.slice(-20)) L.push(`- ${d.title} — ${d.why}${d.rejected ? ` (rejected: ${d.rejected})` : ""}`);
    L.push("");
  }
  if (r.crumbs?.length) {
    L.push("## Recent crumbs (why things are the way they are)");
    for (const c of r.crumbs.slice(-12)) L.push(`- ${c.what} — ${c.why}${c.rejected ? ` (rejected: ${c.rejected})` : ""}`);
  }
  return L.join("\n").trim();
}

try {
  let project = process.env.CLAUDE_PROJECT_DIR;
  if (!project) {
    try {
      const ev = JSON.parse((await readStdin()) || "{}");
      project = ev.cwd || ev.project_dir || process.cwd();
    } catch {
      project = process.cwd();
    }
  }

  const r = memoryStore(project).recall({ limit: 15 });
  if (!r.hasMemory) process.exit(0); // fresh project — nothing to inject

  const text = briefing(r);
  if (!text) process.exit(0);

  const context = `# Project memory (auto-loaded by Engramo)\n\n${text}\n\n_Update it as you work: \`remember\`, \`record_decision\`, \`consolidate\`._`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
  process.exit(0);
} catch {
  process.exit(0); // never block a session on a memory error
}
