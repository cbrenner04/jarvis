# 00 - Attention row projection

## Problem

Awaiting and rejected gates, failed stages, failed and blocked runs, and terminal-publication failures are only discoverable by walking the work tree. Nothing derives the actionable set, so no surface can pin it.

## Decisions

- New pure module `v2/src/tui/tui-attention-rows.ts` exporting a `(pipeline snapshots, run rows) -> rows` projection; no renderer, no selection, no clock. Rules out deriving cap and order inside the renderer.
- Rows are derived from the existing pipeline tree node model (itself a pure function of snapshots and run rows), not by re-deriving stage/run attribution independently. Elision of post-split placeholder stages, the invocation/workflow-collapse join, and node-id derivation are shared with the tree, not duplicated. Rules out the projection silently diverging from what the tree paints.
- A stage absent from the tree node model (elided placeholder) never pins, whatever its status. Rules out an attention row whose target node id matches no tree node and no right-pane detail.
- A pipeline tree node pins as a **gate** row when its node kind is `gate` and its state is `awaiting` or `rejected`; this reads only that node's own kind/state fields, so the gate/failure split stays inside the pure projection. Every other actionable node kind pins as a **failure** row.
- Sources: awaiting gate node, rejected gate node, failed stage node, `failed` run row, `blocked` run row, terminal-publication failure. `killed`, `interrupted`, and `budget-soft-stopped` runs do not pin — rules out treating operator-initiated termination as actionable work.
- A `failed`/`blocked` run row pins only when its attributed stage node did not already pin a failure; the stage row is the actionable unit. Rules out one failure consuming two cap slots.
- `where` for a pipeline-attributed run row — including one that pins while its stage does not — is the same `<pipelineRowLabel(snapshot)> › <branchKey>` as its stage (slug alone on the `default` branch). Rules out inventing a second `where` shape for run-sourced pins. `where` for an ad-hoc run is the ad-hoc node label.
- Cap at six attention rows plus one display-only `+N more` overflow row, where N counts every row the cap dropped. The cap applies to the merged row set across every daemon's snapshots, since the projection already receives merged input. Rules out counting the overflow row against the six.
- Order gate rows before failure rows; inside each group dated rows ascend by `sinceMs` then by target node id, and undated rows follow, ordered by target node id. Rules out one timestamp sort across both groups, rules out nondeterministic ordering when two rows settle in the same millisecond, and rules out an undated legacy row taking an oldest-first slot unpredictably.
- Awaiting-gate `sinceMs` is the `endedAt` of the nearest lower-`position` settled record in the gate's branch chain, `null` when none carries one. Rules out pipeline `createdAt` as a stand-in.
- Rejected-gate `sinceMs` is `decidedAt`; failed-stage `sinceMs` is `endedAt`; run `sinceMs` is `finishedAtMs`.
- Terminal-publication-failure `sinceMs` is derived directly from the pipeline's last stage's durable terminal timestamp (`endedAt`), not from the pipeline's `finishedAtMs` field, which falls back to `createdAt` when no stage settled durably. `sinceMs` is `null` when no stage carries a durable terminal timestamp. Rules out fabricating an age through that fallback — the exact case the intent's no-fabrication rule targets.
- A row whose source carries no durable timestamp otherwise (e.g. a legacy terminal run without `finishedAtMs`) keeps `sinceMs: null` and stays pinned. Rules out fabricating an age from `createdAt` or a display clock.
- `what` is the stage id for gate and stage rows, `workflowRoleLabel(run)` for run rows, and `publication` for terminal-publication failures. Rules out an empty `what` on a pipeline-scoped row.
- Row id is `attention:<targetNodeId>`; the overflow row carries no id and no target. Rules out one selection id matching both a pin and its tree row.
- Rows carry `sinceMs` and no formatted age. Rules out clock-dependent output in a pure projection.

## Acceptance criteria

- [ ] The projection maps pipeline snapshots and run rows to one row per actionable source — awaiting gate, rejected gate, failed stage, failed run, blocked run, terminal-publication failure — each carrying row kind, selectable row id, target node id, and nullable `sinceMs`; `tui-attention-rows.test.ts` — `derives one row per actionable source` covers all six and fails against the pre-fix code.
- [ ] Seven actionable items yield six attention rows plus a `+1 more` overflow row; gate rows precede failure rows and each group is oldest first.
- [ ] Awaiting-gate age starts at its predecessor stage's `endedAt`, rejected-gate age at `decidedAt`, failed-stage age at `endedAt`, and run age at `finishedAtMs`.
- [ ] Terminal-publication-failure age starts at the pipeline's last stage's durable `endedAt`, and is `null` — not the pipeline's `createdAt` — when no stage settled durably.
- [ ] A terminal run without `finishedAtMs` stays pinned with `sinceMs: null` rather than `createdAt`.
- [ ] A `killed` run and an `interrupted` run pin no row, and a failed run belonging to a stage that already pins a failure adds no second row.
- [ ] A failed or blocked placeholder stage absent from the pipeline tree node model pins no row.
- [ ] A rejected gate node pins a gate row (`✋` glyph, gate group) while a failed stage node otherwise shaped the same pins a failure row (`✗` glyph, failure group).
- [ ] Two attention rows with equal `sinceMs` sort by ascending target node id.
- [ ] `tui-attention-rows.test.ts` — `sorts undated rows after dated attention`; Mutation checkpoint: inverting the undated-row ordering guard makes the scoped test fail.
- [ ] Every guard added by this subspec has a scoped test that fails when the guard is inverted, including the negative cases that suppress rows (excluded run statuses, stage-covered runs, elided-placeholder targets, over-cap rows).
- [ ] `tui-attention-rows.test.ts` — `caps attention rows at six plus an overflow row`; Keystone checkpoint: reverting the projection to an empty row list makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None. The projection has no operator-visible surface until it is painted; operator and parity docs land with `01` and `02`, the first consumers.
