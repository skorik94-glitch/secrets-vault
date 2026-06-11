---
name: memory
description: Use on any non-trivial coding task or long-running project. Gives the agent durable, cross-session project memory so it never loses context or repeats mistakes — recall the project's state at the start, log crumbs on significant events, keep the living state current, and consolidate before finishing. Trigger when starting work in a project, when the task is large/multi-step, when resuming after a break, or whenever you feel you're missing context about decisions made earlier.
---

# Project memory — never lose the thread

This plugin gives the agent a real memory layer per project (`.agent/` in the repo):
a **constitution** of standing lenses (identity · do-not · taste · invariants), a
**living state** summary, a **decision log**, and a **journal of crumbs**. Use it so
work compounds across sessions instead of restarting from zero each time.

`project` for every tool below is the project root path (the repo you're working in).

## At the start of a session or task — RECALL
Call `recall(project)` **first**. It returns the project's **identity/constitution**
(standing lenses) first, then the living state, recent decisions, and crumbs. Read them
before doing anything — this is how you regain the context that
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

**Salience** (1–5): set it higher for *surprises*, mistakes, and key decisions —
these are what `recall` surfaces first (a small deviation from expectation is exactly
what's worth remembering). Default 3; use 5 for "this changes how the project works".

**Reconsolidation:** when new information makes an earlier crumb/decision wrong or
outdated, log the corrected one with `supersedes=<old id>` (ids are in `recall`/
`search_memory` output). The old entry drops out of current memory but stays in
history/search — so memory stays *correct* without hoarding contradictions.

For durable architectural choices, also call `record_decision(project, title, why, …)`.

## The constitution — STANDING artifacts (durable lenses, surfaced first)
Crumbs and decisions are *events*. Some knowledge is a **standing lens** the agent should
apply on every task — it lives longer than any one task, so it gets its own home and
`recall` renders it **before** state/decisions/crumbs. Call
`record_standing(project, kind, title, body, …)` when you learn one:
- **identity** — who this is for, the telos, what we deliberately do NOT build.
- **world-model** — an invariant, contract, boundary, or source-of-truth (use `subtype`).
- **constraint** — a do-not / guardrail (e.g. "never change the public API silently").
- **taste** — a product/UI principle or an anti-reference (`subtype: do|dont|anti-ref`).
- **learning** — a rule/checklist/principle promoted from a repeated event (a repeated
  mistake is a hole in memory — promote it so it isn't repeated).
Prefer a standing artifact (not a crumb) whenever something should shape *how the agent
works*, not just record *what happened*. Point `refs` at verifiable ground truth (a
path/symbol/test) so the lens can be re-checked, not just trusted. Revise with
`supersedes=<id>` + `supersedeReason`; the old version stays in history.

## Keep the living state current
`update_state(project, content)` holds the short "where things stand" summary an agent
reads first. Keep it tight: current goal, architecture in one breath, open threads,
gotchas. It is the map; the journal is the territory.

## Before finishing / when the journal grows — CONSOLIDATE ("sleep")
Call `consolidate(project)`. It returns the crumbs split into **keep** (high-salience —
generalize these into the state, fold durable ones into decisions) and **prune**
(low-salience noise — drop). Replay them like sleep does: extract the patterns, merge
into the living state, discard the noise. Then call
`consolidate(project, newState=<summary>)` to write the new state and archive the raw
journal. Logging without consolidation is insomnia — periodically sleep.

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
