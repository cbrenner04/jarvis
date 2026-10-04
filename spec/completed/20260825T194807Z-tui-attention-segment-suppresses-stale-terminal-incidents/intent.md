---
name: tui-attention-segment-suppresses-stale-terminal-incidents
---

# Needs-attention surfaces only actionable-now incidents, and never hides the current gate

Unsplit rationale: the whole fix is a read-time transform inside the TUI attention projection (`buildAttentionRows` in `v2/src/tui/tui-attention-rows.ts` plus the clock its callers thread in) — no persistence, daemon, or CLI-admission change, so there is no second module-boundary surface to split against.

## Primary implementation surface

- CLI (TUI attention projection: `v2/src/tui/tui-attention-rows.ts` and its `tui-monitor-lines.ts` / `tui-entry.tsx` callers)

## Problem

`jarvis tui`'s needs-attention segment pins every retained failed-run, blocked-run, rejected-gate, failed-stage, and publication-failure incident with no recency bound and no dismiss action. Dogfooding 2026-08-16 showed `── Needs attention (50) ──` with 48 of those terminal records from prior sessions across 30 days. `approve`/`reject` act only on awaiting-gate rows, a daemon bounce re-derives the rest from durable state, and they only rotate out as retention evicts them — which new failures immediately refill.

The same cap defeats the segment's gate guarantee. Gates sort before failures and, within gates, oldest-`sinceMs`-first, capped at six (`compareAttentionRows` / `ATTENTION_ROW_CAP`). With seven-plus awaiting gates — mostly abandoned dogfood pipelines from prior phases — six ancient gates fill the cap and the operator's current gate lands in the display-only, non-selectable `+N more`. Since the dock `approve` verb takes no id and acts only on the selected row, an unselectable gate cannot be approved from the TUI at all.

## Decisions

- A terminal failed/blocked/publication-failure incident is surfaced only when its durable timestamp falls within a bounded recency window; unresolved awaiting/rejected gates are surfaced regardless of age. Rules out pinning every retained terminal incident forever.
- The window is hours, not days; the plan pins the exact value. Rules out a day-scale window that reproduces the observed 30-day backlog.
- A terminal incident with no durable timestamp is not surfaced. Rules out undated dead rows dominating the segment, which is where the current undated-last ordering lands them once dated rows are suppressed.
- The `── Needs attention (N) ──` heading counts the post-suppression actionable set. Rules out a pre-cap total that still reads as a crisis while the segment shows nothing live.
- The six-row cap and display-only `+N more` overflow stay as they are for failures.
- The recency evaluation time enters the projection as a caller-supplied argument, not a `Date.now()` call inside it. Rules out making the projection impure and its tests clock-dependent.
- A stale-gate backlog must not push the newest gate out of the selectable set; the plan picks the mechanism (candidates: exempt gates from the cap so all gates render while only failures are capped; sort most-recently-reached gate first; make overflow navigable). Rules out keeping oldest-first-within-a-shared-cap, which hides the gate the operator is working on. An old gate still awaiting a decision is not aged out — it just may not displace a newer one.
- No new subcommand and no durable schema change. An id-bearing `approve`/`reject` is tracked in `tui-dock-command-grammar-mirrors-cli`, not here.

## Acceptance criteria

- [ ] A terminal failed/blocked/publication-failure incident whose durable timestamp is older than the recency window is not surfaced, pinned by a pure-function test over the segment model that fails against the pre-fix code.
- [ ] A within-window terminal failure is still surfaced, pinned by a test.
- [ ] An awaiting or rejected gate is surfaced regardless of age, pinned by a test.
- [ ] A terminal incident with no durable timestamp is not surfaced, pinned by a test.
- [ ] With more awaiting gates than the failure cap, the newest gate is rendered and selectable rather than displaced into non-selectable overflow, pinned by a test over the chosen gate-ordering fix.
- [ ] The segment heading count reflects only surfaced incidents, pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Prerequisites

- `jarvis tui` projects awaiting gates, rejected gates, failed stages, failed runs, blocked runs, and terminal publication failures into a single capped, ordered needs-attention segment.
- Attention rows carry a durable timestamp derived from stage `endedAt`/`decidedAt` and run `finishedAtMs`, with `null` for legacy rows that have none.
- The segment heading reports an incident count and a display-only, non-selectable `+N more` overflow line follows the capped rows.
- Attention row ids are selectable ahead of work-tree rows, and the dock `approve`/`reject` verbs act in place on the selected awaiting-gate row.

## Documentation updates

- `v2/docs/operator-runbook.md` — needs-attention now surfaces only actionable-now incidents (gates always; terminal failures only within the recency window, undated ones never), the heading counts the surfaced set, and the gate-ordering rule that keeps the current gate reachable; note that no manual dismiss is needed.
- `v2/docs/v1-behaviors.md` — record the changed segment membership, count, and gate ordering as the current v2 behavior.
