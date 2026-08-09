# 00 - Attention row projection

## Problem

Awaiting and rejected gates, failed stages, failed and blocked runs, and terminal-publication failures are only discoverable by walking the work tree. Nothing derives the actionable set, so no surface can pin it.

## Decisions

- New pure module `v2/src/tui/tui-attention-rows.ts` exporting a `(pipeline snapshots, run rows) -> rows` projection; no renderer, no selection, no clock. Rules out deriving cap and order inside the renderer.
- Sources: awaiting gate, rejected gate, failed stage, `failed` run, `blocked` run, terminal-publication failure. `killed`, `interrupted`, and `budget-soft-stopped` runs do not pin — rules out treating operator-initiated termination as actionable work.
- A failed or blocked run whose pipeline stage already pins a failure does not pin again; the stage row is the actionable unit. Rules out one failure consuming two cap slots.
- Cap at six attention rows plus one display-only `+N more` overflow row, where N counts every row the cap dropped. Rules out counting the overflow row against the six.
- Order gate rows before failure rows; inside each group dated rows ascend by `sinceMs`, then undated rows follow, ordered by target node id. Rules out one timestamp sort across both groups, and rules out an undated legacy row taking an oldest-first slot unpredictably.
- Awaiting-gate `sinceMs` is the `endedAt` of the nearest lower-`position` settled record in the gate's branch chain, `null` when none carries one. Rules out pipeline `createdAt` as a stand-in.
- Rejected-gate `sinceMs` is `decidedAt`; failed-stage `sinceMs` is `endedAt`; run `sinceMs` is `finishedAtMs`; terminal-publication-failure `sinceMs` is the pipeline's `finishedAtMs`.
- A row whose source carries no durable timestamp keeps `sinceMs: null` and stays pinned. Rules out fabricating an age from `createdAt` or a display clock.
- `what` is the stage id for gate and stage rows, `workflowRoleLabel(run)` for run rows, and `publication` for terminal-publication failures. Rules out an empty `what` on a pipeline-scoped row.
- `where` is `<pipelineRowLabel(snapshot)> › <branchKey>` for pipeline-sourced rows (slug alone on the `default` branch) and the ad-hoc node label for ad-hoc runs. Rules out duplicating the full tree row.
- Row id is `attention:<targetNodeId>`; the overflow row carries no id and no target. Rules out one selection id matching both a pin and its tree row.
- Rows carry `sinceMs` and no formatted age. Rules out clock-dependent output in a pure projection.

## Acceptance criteria

- [ ] The projection maps pipeline snapshots and run rows to one row per actionable source — awaiting gate, rejected gate, failed stage, failed run, blocked run, terminal-publication failure — each carrying row kind, selectable row id, target node id, and nullable `sinceMs`; `tui-attention-rows.test.ts` — `derives one row per actionable source` covers all six and fails against the pre-fix code.
- [ ] Seven actionable items yield six attention rows plus a `+1 more` overflow row; gate rows precede failure rows and each group is oldest first.
- [ ] Awaiting-gate age starts at its predecessor stage's `endedAt`, rejected-gate age at `decidedAt`, failed-stage age at `endedAt`, run age at `finishedAtMs`, and terminal-publication-failure age at the pipeline's `finishedAtMs`.
- [ ] A terminal run without `finishedAtMs` stays pinned with `sinceMs: null` rather than `createdAt`.
- [ ] A `killed` run and an `interrupted` run pin no row, and a failed run belonging to a stage that already pins a failure adds no second row.
- [ ] `tui-attention-rows.test.ts` — `sorts undated rows after dated attention`; Mutation checkpoint: inverting the undated-row ordering guard makes the scoped test fail.
- [ ] Every guard added by this subspec has a scoped test that fails when the guard is inverted, including the negative cases that suppress rows (excluded run statuses, stage-covered runs, over-cap rows).
- [ ] `tui-attention-rows.test.ts` — `caps attention rows at six plus an overflow row`; Keystone checkpoint: reverting the projection to an empty row list makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None. The projection has no operator-visible surface until it is painted; operator and parity docs land with `01`, which is the first consumer.
