---
name: tui-status-line-work-counts
---

# Honest work counts in the TUI status line

## Problem

The dock reports `N active` from retained pipeline snapshots. Awaiting approval counts as active, so parked and running work are indistinguishable, while ad-hoc workflow invocations are omitted.

## Decision ledger

- Replace `N active` and `countActivePipelines` with `N running · N awaiting gate · N failed · N done`. Rules out retaining an ambiguous aggregate beside the split counts.
- Count top-level work items: one per distinct pipeline id or ad-hoc workflow-invocation group. Rules out counting pipeline observations, stages, or constituent runs.
- Classify a reachable undecided gate as `awaiting gate`, any other non-terminal item as `running`, terminal success as `done`, and every other terminal item as `failed`. Rules out status-specific terminal buckets.
- Classify ad-hoc groups through the existing group rollup and never as `awaiting gate`. Rules out treating paused or blocked runs as approval gates.
- Count contradictory retained observations for one pipeline id once, choosing `awaiting gate` over `running`, `running` over `failed`, and `failed` over `done`. Rules out inflating totals during cross-daemon overlap or letting stale terminal evidence hide live work.
- Keep counts before `profile@digest`, refresh, and feedback so right truncation preserves them. Rules out hiding the primary status under narrow-width feedback.
- Make no left-pane change. Rules out coupling status aggregation to the pinned segment.

## Acceptance criteria

- [ ] The dock renders `N running · N awaiting gate · N failed · N done` before `profile@digest`; a `tui-monitor-lines.test.ts` case with one parked and one running pipeline fails against the pre-fix `N active` output.
- [ ] An awaiting-gate pipeline counts only under `awaiting gate`; a live implement pipeline counts under `running`; succeeded counts under `done`; failed, rejected, and interrupted count under `failed`.
- [ ] An ad-hoc workflow-invocation group counts under `running` while any member is non-terminal, then under `done` or `failed` after every member terminates.
- [ ] Multiple retained observations of one pipeline id contribute one count in the precedence bucket: `awaiting gate`, then `running`, then `failed`, then `done`.
- [ ] `countActivePipelines` no longer exists under `v2/src/`.
- [ ] `tui-monitor-lines.test.ts` — `deduplicates contradictory pipeline snapshots by bucket precedence`; Mutation checkpoint: inverting the duplicate-bucket precedence guard makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — four count definitions, ad-hoc coverage, and retained-observation deduplication.
- `v2/docs/v1-behaviors.md` § TUI / observability — the status-line replacement and per-item classification.

## Prerequisites

- Pipelines and ad-hoc workflow-invocation groups are top-level nodes in one work tree.
- Ad-hoc work items are never ranked as gated.
- Pipeline observation derives `awaiting-approval` for a reachable undecided approval stage and distinguishes terminal states.
- Workflow-group rollup distinguishes a group with any non-terminal member from a fully terminal group.
- Per-socket pipeline snapshots merge into a list that may contain repeated pipeline ids.
- The dock composes its status row before display-width truncation.
