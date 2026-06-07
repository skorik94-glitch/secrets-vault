---
name: memory
description: Use on any non-trivial coding task or long-running project. Gives the agent durable, cross-session project memory so it never loses context or repeats mistakes — recall the project's state at the start, log crumbs on significant events, keep the living state current, and consolidate before finishing. Trigger when starting work in a project, when the task is large/multi-step, when resuming after a break, or whenever you feel you're missing context about decisions made earlier.
---

# Project memory — never lose the thread

This plugin gives the agent a real memory layer per project (`.agent/` in the repo):
a **living state** summary, a **decision log**, and a **journal of crumbs**. Use it so
work compounds across sessions instead of restarting from zero each time.

`project` for every tool below is the project root path (the repo you're working in).

## At the start of a session or task — RECALL
Call `recall(project)` **first**. It returns the living state, recent decisions, and
crumbs. Read them before doing anything — this is how you regain the context that
Claude/Codex otherwise lose between sessions. If `hasMemory` is false, this is a fresh
project; you'll be building the memory as you go.

## Before coding — frame the task (meaning first, then code)
Restate the goal, constraints, and non-goals in one or two lines. Surface assumptions
explicitly. If the request is ambiguous or under-specified, **ask 1–3 clarifying
questions or reformulate it back** — users often don't state precisely what they want,
and a wrong assumption here is the #1 cause of "the agent misunderstood me." Only then write code.

## During work — REMEMBER (drop crumbs)
Call `remember(project, what, why, …)` on each significant event:
- a decision (and `rejected` alternatives, `revisitIf` condition),
- a non-obvious problem and how you solved it,
- a change of direction,
- a learned constraint about the product/codebase,
- a mistake (so it isn't repeated).
Always include **why** — the reasoning is the valuable part, not the what. Routine
edits don't need a crumb (git already records those).

For durable architectural choices, also call `record_decision(project, title, why, …)`.

## Keep the living state current
`update_state(project, content)` holds the short "where things stand" summary an agent
reads first. Keep it tight: current goal, architecture in one breath, open threads,
gotchas. It is the map; the journal is the territory.

## Before finishing / when the journal grows — CONSOLIDATE ("sleep")
Call `consolidate(project)` to get the raw crumbs, compress them into an updated state
(merge into decisions where durable), then call `consolidate(project, newState=<summary>)`
to write the new state and archive the raw journal. Logging without consolidation is
insomnia — periodically sleep.

## Local context — read the right docs for the file (fractal docs)
Before editing a file, call `local_context(path, project)` to load the nearest
CLAUDE.md/AGENTS.md from repo root down to that file's folder — act on the *local*
rules, not a global blob. Keep folder-level docs short and current; use
`doc_map(project)` to see where docs are missing and fill the important gaps.

## Principles (apply throughout)
- **Meaning before code.** Understand the why; restate the task.
- **Fractal docs.** Keep context local — repo / module / folder level — so the right
  context loads for the file being edited.
- **Occam's razor.** Simplest reliable approach; don't over-engineer.
- **The reasoning is the memory.** Record *why*, not just *what*.
