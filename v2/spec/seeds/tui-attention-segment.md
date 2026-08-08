---
name: tui-attention-segment
---

# TUI attention segment — pinned "needs me" list and honest status counts

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on the unified tree (`tui-unified-work-tree`); idle times need `pipeline-terminal-timestamps`.

## Problem

The command center's first question is "what needs me" and the TUI never answers it. Dogfooding: six pipelines sat at approval gates for up to six days while the status line said `7 active` — `countActivePipelines` counts `awaiting-approval` as active, so parked-on-operator and working are indistinguishable. Failed stages and dead runs are equally buried in the tree.

## Decisions

- A pinned segment renders at the top of the left pane, above the work tree, capped at 6 rows with a `+N more` overflow row. Rules out attention-by-scrolling.
- Row sources: awaiting gates, rejected gates, failed stages, failed/blocked runs, terminal-publication failures. Order: gates first, then failures; within each, oldest (longest waiting/idle) first.
- Row content: glyph (`✋` gate, `✗` failure) · what (`approve-plan`, `implement`, run role) · where (pipeline seed slug › branch, or ad-hoc label) · since (awaiting-since from predecessor `endedAt` / failure age).
- Attention rows are selectable in the normal `j`/`k` order (they precede tree rows); selecting one shows the underlying node's detail in the right pane; `approve`/`reject` dock verbs act on a selected gate row exactly as on the gate's tree node; Enter reveals the node in the tree (expands ancestors, moves selection there).
- Status line: `N running · N awaiting gate · N failed · N done` replaces `N active`. Running = non-terminal and not awaiting-approval; counts cover pipelines and ad-hoc items uniformly. Rules out `countActivePipelines` as shipped.
- Empty attention state renders nothing (no empty heading).

## Acceptance criteria

- [ ] A pure builder maps `(pipeline snapshots, run rows)` to attention rows with kind, target node id, and since-timestamp; pins for each source: awaiting gate, rejected gate, failed stage, failed run, blocked run, publication failure.
- [ ] Cap pins: 7+ items render 6 rows + `+N more`; ordering pins gates-before-failures and oldest-first within each.
- [ ] Attention rows precede tree rows in the selectable order; selecting one renders the underlying node's right-pane detail.
- [ ] `approve` on a selected attention gate row dispatches the same daemon call as approving the gate's tree node; Enter selects and reveals the node in the tree.
- [ ] Status line pins: a parked pipeline counts under `awaiting gate`, not `running`; a live implement counts under `running`; terminal items under `done`/`failed`.
- [ ] With no actionable items, the segment renders zero rows.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — attention segment semantics, glyphs, and the status-line count definitions.

## Prerequisites

- `v2/src/tui/tui-monitor-lines.ts` — `countActivePipelines`, `dockStatusLine`, `monitorSelectableNodeIds`
- `v2/src/daemon/pipeline-observation.ts` — `derivePipelineBoundary` (awaiting gate + branch), stage `endedAt`, `terminalPublicationFailure`
- `v2/src/tui/tui-command-parser.ts` + dispatch — existing `approve`/`reject` seams
- Seed `pipeline-terminal-timestamps` — `decidedAt` / honest terminal timestamps for since-ages
