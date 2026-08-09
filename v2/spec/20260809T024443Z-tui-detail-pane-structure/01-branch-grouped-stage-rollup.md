# Branch-grouped stage roll-up with compact gate rows

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The `Stages` roll-up walks `snapshot.stages` in durable order and paints one uniform row each, so a fanned-out pipeline interleaves branches the left-pane tree already separated, and the operator has to read `branch=` on every row to reassemble what the tree shows structurally. The roll-up also paints the rows the tree deliberately dropped: post-split `default` placeholders, which `admitFanOutBranches` always settles `skipped` and which carry nothing, and satisfied gates, which paint a full stage row to say one word.

## Decision ledger

- Grouping lives in `pipelineStageRollupGroups(snapshot)` exported from `v2/src/tui/tui-monitor-pipeline-tree.ts`, next to `fanOutSplitPosition` and `isElidedPlaceholderStage`. Rules out re-deriving the split position in the renderer, which would drift from the tree the roll-up is supposed to mirror; rules out reading the built tree nodes, which drop the gate records this roll-up must keep.
- The grouper returns pre-split records first, then one group per non-`default` post-split `branchKey` in first-encounter order. Rules out sorting branch groups by key or by status — the tree's order is the thing being mirrored.
- Post-split `default` placeholder records are dropped by the grouper via `isElidedPlaceholderStage`. Reverses the prior spec's "placeholder records stay visible in the roll-up" concession; rules out keeping a dead row for record completeness when the pane already has no other way to show it.
- Gate rows are recognized by status `approved` / `rejected`, not by resolving the pipeline definition. Rules out a second `getPipelineDefinition` lookup in the renderer, and safe because both statuses are approval-only — `state-store.ts` keeps them out of `TERMINAL_STAGE_STATUSES` precisely because they end a decision, not a stage run. An `awaiting`, `pending`, or `skipped` gate keeps the ordinary stage row.
- The gate row's decided age comes from the record's `endedAt`, the only decision timestamp on the wire today, and is dropped when the formatted age is empty. `commitApprovalDecision` does not stamp `endedAt`, so live decided gates currently paint outcome alone and light up the age once the approval-decision timestamp lands (`pipeline-terminal-timestamps` seed). Rules out blocking this subspec on that wire change.
- Every roll-up field is emitted through one `label=value` composer that drops empty values, so an empty `elapsed` and an absent decided age disappear by the same rule. Rules out one conditional per field, and rules out painting `elapsed=` with nothing after it — the dead-field complaint this spec exists to fix.
- The per-row `branch=` field is dropped; the group heading carries the branch. Rules out repeating the key on every row when the grouping already states it.
- The group heading is `Branch <full unstripped branchKey>` — the tree's stripped label expands here. Rules out `branch: <key>`, which collides with the `Stage` and `Branch` sections' own `branch:` field on screen and in assertions.
- Out of scope: reusing the new grouper inside `buildStageNodes` (a tree-construction refactor), artifact rendering (subspec 02), and the `Workflow` step row's composed text.

## Prerequisites

- Subspec 00 has landed: `DetailSection`, `joinDetailSections`, and `isEmptyDetailValue` exist in `v2/src/tui/tui-monitor-lines.ts` and the `Stages` block is already a section.
- `fanOutSplitPosition` and `isElidedPlaceholderStage` derive the fan-out split and placeholder records in `v2/src/tui/tui-monitor-pipeline-tree.ts`.
- `commitApprovalDecision` moves an `awaiting` approval record to `approved` or `rejected` (`v2/src/persistence/state-store.ts`), and those statuses are excluded from `TERMINAL_STAGE_STATUSES`, so a decided record's `endedAt` is normally `null`.
- `formatElapsedWallClock(start, null, now)` returns `""` for a `null` start or a non-positive duration (`v2/src/tui/tui-elapsed-format.ts`).

## Tasks

- `v2/src/tui/tui-monitor-pipeline-tree.ts`:
  - Add `export type PipelineStageRollupGroup = { branchKey: string | null; records: readonly PipelineSnapshot["stages"][number][] }`.
  - Add `export function pipelineStageRollupGroups(snapshot: PipelineSnapshot): PipelineStageRollupGroup[]` opening `const split = fanOutSplitPosition(snapshot);`, then a loop over `snapshot.stages` whose first statement is `if (isElidedPlaceholderStage(stage, split)) continue;` (guard-mutation anchor) followed by `const branched = split !== null && stage.position >= split;` (keystone-mutation anchor, one physical line); unbranched records accumulate into the pre-split group, branched records into a per-`branchKey` map with a first-encounter order list. Return the pre-split group (`branchKey: null`) followed by the branch groups, omitting any group with no records. Both anchor lines must not reuse the identifiers `splitPosition` or `isBranched` from `buildStageNodes`.
- `v2/src/tui/tui-monitor-lines.ts`:
  - Add `function rollupFields(fields: readonly (readonly [label: string, value: string])[]): string` opening `const present = fields.filter(([, value]) => value !== "");` (guard-mutation anchor) and returning the `label=value` pairs joined by a single space.
  - Add `function isDecidedGateStatus(status: string): boolean` whose whole body is `return status === "approved" || status === "rejected";` — guard-mutation anchor, one physical line.
  - Add a roll-up row builder: a decided gate paints the literal `gate:`, the stage id, then `rollupFields([["outcome", status], ["decided", formatElapsedWallClock(endedAt, null, nowMs)]])`, single-space separated; every other record paints `stage:`, the stage id, then `rollupFields([["status", status], ["elapsed", formatElapsedWallClock(startedAt, endedAt, nowMs)]])`.
  - Build the `Stages` section from `pipelineStageRollupGroups(snapshot)`: the pre-split group's rows first, then for each branch group a `Branch <branchKey>` row followed by its rows.
- Tests — `v2/src/tui/tui-monitor-pipeline-tree.test.ts`:
  - Add `the stage roll-up groups post-split records under their branch after the pre-split records` — a fanned-out snapshot with two branches; assert the returned group order, `branchKey` values, and record membership. Carries the keystone `// @mutate`.
  - Add `the stage roll-up drops the post-split default placeholder record` — the same snapshot plus a post-split `default` record; assert it appears in no group. Carries the placeholder guard `// @mutate`.
- Tests — `v2/src/tui/tui-monitor-lines.test.ts`:
  - Add `a decided gate record paints a compact gate row with its outcome` — a snapshot with an `approved` gate whose `endedAt` is `null` and a `rejected` gate whose `endedAt` is set; assert the exact rows `gate: approve-intent outcome=approved` and `gate: approve-plan outcome=rejected decided=<age>`. Carries the `isDecidedGateStatus` guard `// @mutate`.
  - Add `roll-up rows drop an empty elapsed and an empty decided age` — a `pending` stage with `startedAt: null` and an `approved` gate with `endedAt: null`; assert the exact rows `stage: plan status=pending` and `gate: approve-intent outcome=approved`. Carries the `rollupFields` guard `// @mutate`.
  - Add `the pipeline roll-up heads each branch group with its full unstripped branch key` — the two-branch snapshot from `selecting a branch node renders pipeline context and the full branch key`; assert the roll-up rows are pre-split records, then `Branch tui-pipeline-tree-model` and its records, then `Branch tui-pipeline-tree-monitor` and its records.
  - Update `an elided gate's stage record still lists in the pipeline detail roll-up` to expect `gate: approve-intent outcome=approved`, and update the pinned `pipelineBlock`, `stage selection appends the selected durable record with exact branch and stable diagnostics`, `attributed run detail is resolved only from the selected durable row`, and `resolves pipeline detail for off-pane tree row selection` roll-up rows for the dropped `branch=` field and the dropped empty `elapsed=`.
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the stage roll-up groups post-split records under their branch after the pre-split records` asserts the grouper returns the pre-split records first and then one group per fan-out `branchKey` in first-encounter order; it fails against the pre-fix code, which has no grouper at all.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the stage roll-up groups post-split records under their branch after the pre-split records`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const branched = split !== null && stage.position >= split;" -> "const branched = false;"` inside the test body — reporting no fan-out, so every record lands in one pre-split group in durable order (baseline semantics) — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the stage roll-up drops the post-split default placeholder record` asserts a post-split `default` record appears in no group; it fails against the pre-fix code, whose roll-up lists it.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the stage roll-up drops the post-split default placeholder record`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (isElidedPlaceholderStage(stage, split)) continue;" -> "if (false) continue;"` inside the test body — dropping nothing, so the placeholder record reappears in the pre-split group — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `a decided gate record paints a compact gate row with its outcome` asserts an `approved` record with no end timestamp paints `gate: approve-intent outcome=approved` and a `rejected` record with one paints its outcome plus the decided age; it fails against the pre-fix code, which paints both as full `stage:` rows.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `a decided gate record paints a compact gate row with its outcome`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "return status === \"approved\" || status === \"rejected\";" -> "return false;"` inside the test body — recognizing no decided gate, so both records paint ordinary stage rows again — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `roll-up rows drop an empty elapsed and an empty decided age` asserts a `startedAt`-less stage paints `stage: plan status=pending` and an undated decided gate paints `gate: approve-intent outcome=approved`; it fails against the pre-fix code, which paints a trailing `elapsed=`.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `roll-up rows drop an empty elapsed and an empty decided age`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-lines.ts "const present = fields.filter(([, value]) => value !== \"\");" -> "const present = [...fields];"` inside the test body — keeping empty fields, so the rows regrow `elapsed=` and `decided=` with nothing after them — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `the pipeline roll-up heads each branch group with its full unstripped branch key` asserts each branch group is headed by `Branch <full branchKey>` with the tree's stripped label expanded, and that no roll-up row carries a `branch=` field; it fails against the pre-fix code, which paints `branch=` per row and no headings.
- [x] The stage-selection detail still resolves by stage id and branch key: `v2/src/tui/tui-monitor-lines.test.ts` — `stage detail under a branch is that branch's own record` stays green with no edit.
- [x] `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row records the branch-grouped roll-up (pre-split records, then one `Branch <branchKey>` group each), that post-split `default` placeholder records no longer list, and that a decided gate lists compactly as its outcome plus a decided age when the record carries one — superseding the prior statement that placeholder records stay visible in the roll-up.
- [x] `v2/docs/v1-behaviors.md` § TUI / observability records the branch-grouped roll-up, the placeholder drop (correcting the prior "records stay visible in the pipeline's Stages roll-up" claim), the status-derived compact gate row, and the empty-field drop in roll-up rows.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row — branch-grouped stage roll-up, dropped post-split placeholders, compact decided-gate rows with optional decided age.
- `v2/docs/v1-behaviors.md` § TUI / observability — roll-up grouping via `pipelineStageRollupGroups`, the placeholder drop that supersedes the prior claim, status-derived gate rows, and empty-field suppression in composed roll-up rows.
