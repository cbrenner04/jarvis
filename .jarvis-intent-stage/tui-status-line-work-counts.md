---
name: tui-status-line-work-counts
---

# Honest work counts in the TUI status line

## Problem

The dock status line reads `N active`, computed by `countActivePipelines` over retained `pipeline_list` snapshots: a pipeline counts as active whenever any retained observation is non-terminal, and `awaiting-approval` is non-terminal. Dogfooding read `7 active` while six of those pipelines had been parked at approval gates for up to six days — parked-on-operator and working are indistinguishable. Ad-hoc workflow invocations are not counted at all, so the number does not describe the work tree it sits under.

## Decisions

- Status line reads `N running · N awaiting gate · N failed · N done`; `N active` and `countActivePipelines` go. Rules out keeping `active` alongside the split counts.
- Counts cover every top-level work item in the tree — pipelines and ad-hoc invocation groups — under one classification. Rules out a pipeline-only count under a unified tree.
- Classification: parked at an undecided reachable gate → `awaiting gate`; other non-terminal → `running`; terminal success → `done`; every other terminal → `failed`. Rules out per-status buckets, which would need a column per terminal status.
- Ad-hoc groups classify off the existing group rollup (any non-terminal member → running) and never count as `awaiting gate`. Rules out mapping `paused`/`blocked` runs onto the gate bucket.
- Contradictory retained observations for one pipeline id still contribute one count. Rules out counting per observation across daemons.
- The counts keep the status line's leading position, ahead of `profile@digest` and `refresh`, so right-truncation drops feedback before counts. Rules out appending counts after the retained feedback channels.
- No left-pane changes here; the pinned attention list rides a later intent.

## Acceptance criteria

- [ ] The dock status line renders `N running · N awaiting gate · N failed · N done` ahead of `profile@digest`; a `tui-monitor-lines.test.ts` test naming a parked pipeline plus a live one fails against the pre-fix code, which reports both as `active`.
- [ ] A pipeline whose only undecided stage is an awaiting gate counts under `awaiting gate` and not under `running`.
- [ ] A pipeline with a live implement stage counts under `running`; a succeeded pipeline counts under `done`; failed, rejected, and interrupted pipelines count under `failed`.
- [ ] An ad-hoc workflow-invocation group counts under `running` while any member is non-terminal, and under `done` or `failed` once every member is terminal.
- [ ] Two retained observations of one pipeline id contribute one count.
- [ ] `countActivePipelines` no longer exists anywhere under `v2/src/`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — replace the "Status counts distinct retained pipelines as active…" sentence with the four counts, their classification, their coverage of ad-hoc items, and the retained-duplicate rule.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the status-line replacement, the per-item classification, and the removal of `countActivePipelines`.

## Prerequisites

- Every top-level work item — pipeline and ad-hoc workflow-invocation group — is a node in one left-pane work tree, with the Unattributed segment and its FIFO deleted.
- Ad-hoc work items are never ranked as gated.
- `derivePipelineState` derives `awaiting-approval` for a pipeline parked at a reachable undecided approval stage, and `isPipelineTerminal` classifies the terminal states.
- `workflowGroupHasActiveMember` rolls a collapsed invocation group up to non-terminal versus terminal.
- `mergePipelineSnapshots` merges retained per-socket `pipeline_list` snapshots into one list that can repeat a pipeline id.
- `monitorDockLines` composes the status row and right-truncates it by display width.
