# Elide satisfied gates and show the intent yield

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

After subspec 00 the branch level exists, but a `full-review` pipeline still paints one row per approval record regardless of outcome — an `approved` or `skipped` gate is an inert row whose only content is a decision already made and already implied by the stage after it. And the one thing the operator most wants from the intent row — that this seed split into N intents — is visible only as one-line artifact JSON in the detail pane.

## Decision ledger

- Gate rows render only when `awaiting` or `rejected`; every other approval status, including `pending`, is elided. Rules out inert decision rows, and rules out enumerating `approved`/`skipped` as the elided set — an unreached `pending` gate is just as inert.
- Stage kind comes from the pipeline definition resolved by `snapshot.name` through `getPipelineDefinition`. Rules out adding `kind` to the `pipeline_list` wire, and rules out inferring gate-ness from status alone — a skip-settled workflow stage and a skipped gate are both `skipped`.
- A `snapshot.name` that resolves to no registry definition yields no kinds, so nothing is gate-elided and the tree renders as it does today. Rules out treating unknown names as an error surface in the monitor.
- Elided gate records stay in the snapshot, so the detail pane's stage roll-up still lists them. Rules out filtering `snapshot.stages` itself.
- Any stage whose artifact carries a non-empty `downstreamInputs` array renders its row label as `<stageId> → N intents`; the intent stage is the one that has it. Rules out keying the suffix on `stageId === "intent"`, which breaks the moment a definition renames or moves the split stage.
- The suffix is literal `→ N intents` with no singular form. Rules out a pluralization branch for a case (`→ 1 intents`) that a split never produces — fan-out with one downstream input is a degenerate admission, not the operator-facing case.
- `MonitorPipelineTreeStageNode` gains `label`, painted by `buildStageMonitorTreeRow` in place of `stageId`. Rules out computing the suffix inside the paint helper, which would have to reach back through the snapshot for the artifact.
- Accepted behavior change: `approve` / `reject` on a non-`awaiting` gate of a registry-named pipeline now reports `stale_non_targetable` (the row is gone) where it reported `not_awaiting_stage`. Rules out keeping elided gates as invisible steering targets.
- Assertions run through the pure builders and the injected input hook; no rendered-ink frame assertions (`v2/docs/test-writing.md` § TUI test strategy).
- Out of scope: everything subspec 00 owns, row appearance (`tui-work-row-anatomy`), and semantic artifact rendering in the detail pane (`tui-detail-pane-structure`).

## Prerequisites

- Subspec 00 has landed: `MonitorPipelineTreeBranchNode`, `fanOutSplitPosition`, and the pre-filter-then-claim stage builder exist in `v2/src/tui/tui-monitor-pipeline-tree.ts`.
- `getPipelineDefinition(name)` returns `{ ok: true, definition }` whose `stages` carry `kind: "workflow" | "approval"`, or `{ ok: false }` for an unregistered name (`v2/src/execution/pipeline-registry.ts`); `v2/src/commands/tui.ts` already imports it, so the TUI surface may.
- A pipeline row's `name` is its definition name (`createPipeline` persists `definition.name`; `projectPipelineSnapshot` projects it).
- Approval stage records carry `pending`, `awaiting`, `approved`, or `rejected`, and a decision moves an `awaiting` record to `approved` or `rejected` (`v2/src/daemon/pipeline-execution.ts`, `v2/src/persistence/state-store.ts`).
- `PipelineSnapshot["stages"][number].artifact` carries the intent stage's `downstreamInputs` list (`v2/src/daemon/pipeline-observation.ts`).

## Tasks

- `v2/src/tui/tui-monitor-pipeline-tree.ts`:
  - Import `getPipelineDefinition` from `../execution/pipeline-registry.ts`.
  - Add `function resolveStageKinds(name: string): Map<string, string>` whose body is `const resolved = getPipelineDefinition(name);` / `if (!resolved.ok) return new Map();` (guard-mutation anchor) / a map from `stageId` to `kind`.
  - Add `function isElidedGateStage(kind: string | undefined, status: string): boolean` opening `if (kind !== "approval") return false;` (guard-mutation anchor) and ending `return status !== "awaiting" && status !== "rejected";` — that return is the keystone-mutation anchor and must stay on one physical line.
  - Add `function intentYieldSuffix(artifact: unknown): string` that resolves `downstreamInputs` to an array (empty when absent or not an array), then `if (inputs.length === 0) return "";` (guard-mutation anchor) followed by a return of the space-prefixed template literal `" → ${inputs.length} intents"`.
  - Add `label: string` to `MonitorPipelineTreeStageNode`, set it to `` `${stage.stageId}${intentYieldSuffix(stage.artifact)}` `` when building stage nodes, and paint `label: node.label` in `buildStageMonitorTreeRow`.
  - Extend the stage visibility filter with `isElidedGateStage(stageKinds.get(stage.stageId), stage.status)`, resolving `stageKinds` once per snapshot.
- Tests — add to `v2/src/tui/tui-monitor-pipeline-tree.test.ts`:
  - `an approved gate row is absent while an awaiting gate row renders` — `name: "full-review"`, no fan-out, records `intent: succeeded`, `approve-intent: approved`, `plan: succeeded`, `approve-plan: awaiting`, `implement: pending`; assert the `approve-intent` node id is absent and the `approve-plan` and `implement` ids are present. Carries the keystone `// @mutate`.
  - `a post-split workflow stage settled skipped still renders under its branch` — `name: "full-review"` fanned out, one branch whose `implement` record is `skipped`; assert that stage node renders under its branch. Carries the `kind !== "approval"` guard `// @mutate`.
  - `a skipped gate row is absent from a fanned-out branch subtree` — `name: "full-review"` fanned out, one branch whose `approve-plan` record is `skipped`; assert that node id is absent from the flatten. Carries the registry-resolution guard `// @mutate`.
  - `the intent stage row appends the split yield only when the artifact lists downstream inputs` — an `intent` stage with `artifact: { downstreamInputs: ["a.md", "b.md", "c.md"] }` and a `plan` stage with `artifact: null`; assert the painted `label` cells are `intent → 3 intents` and `plan`. Carries the `downstreamInputs` guard `// @mutate`.
- Update `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v2/spec/tui-command-center-brief.md` per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `an approved gate row is absent while an awaiting gate row renders` asserts an `approved` gate's stage node id is absent from the flattened tree while an `awaiting` gate's and a following workflow stage's ids are present; it fails against the pre-fix code, which renders every approval record.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `an approved gate row is absent while an awaiting gate row renders`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return status !== \"awaiting\" && status !== \"rejected\";" -> "return false;"` inside the test body — eliding no gate, so every approval record renders again (baseline semantics) — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a post-split workflow stage settled skipped still renders under its branch` asserts a `skipped` workflow stage under a fan-out branch keeps its row; it fails against the pre-fix code, which has no stage-kind resolution at all.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a post-split workflow stage settled skipped still renders under its branch`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (kind !== \"approval\") return false;" -> "if (kind === \"approval\") return false;"` inside the test body — applying the gate rule to workflow stages, so a skip-settled workflow stage disappears — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a skipped gate row is absent from a fanned-out branch subtree` asserts a branch's `skipped` gate node id is absent from the flattened tree; it fails against the pre-fix code, which renders it.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a skipped gate row is absent from a fanned-out branch subtree`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (!resolved.ok) return new Map();" -> "if (resolved.ok) return new Map();"` inside the test body — dropping kinds for registry-known names, so no gate is recognized and the skipped gate reappears — and the mutation turns that regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the intent stage row appends the split yield only when the artifact lists downstream inputs` asserts the intent stage's painted label is `intent → 3 intents` for a three-entry `downstreamInputs` artifact and that a stage with no such artifact paints its bare stage id; it fails against the pre-fix code, which paints `stageId` alone.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the intent stage row appends the split yield only when the artifact lists downstream inputs`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (inputs.length === 0) return \"\";" -> "if (inputs.length < 0) return \"\";"` inside the test body — suffixing every stage, so an artifact-less stage's label gains a `→ 0 intents` suffix — and the mutation turns that regression RED.
- [x] A snapshot whose `name` matches no registry definition renders every gate-shaped row unchanged: the existing `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-monitor-lines.test.ts`, and `v2/src/tui/tui-entry.test.tsx` suites — whose pipeline fixtures all carry unregistered names — stay green, including the `not_awaiting_stage` approve/reject assertions.
- [x] An elided gate's record still reaches the detail pane: the right-pane `Stages` roll-up for a `full-review` pipeline lists the `approved` gate that the tree no longer paints (asserted in `v2/src/tui/tui-monitor-lines.test.ts`).
- [x] `v2/docs/operator-runbook.md` § Observe records that gate rows appear only while `awaiting` or `rejected`, that decided and unreached gates leave the tree with their records still in the detail pane, and that the intent row shows `→ N intents` when the stage split.
- [x] `v2/docs/v1-behaviors.md` § TUI / observability pipeline-tree bullet records stage kind resolved from the registry definition by `snapshot.name` (unregistered names elide nothing), the gate render rule, the `→ N intents` label suffix, and that `approve` / `reject` on a non-`awaiting` gate of a registry-named pipeline now reports `stale_non_targetable`.
- [x] `v2/spec/tui-command-center-brief.md` seed table row 3 records `tui-intent-branch-subtree` as shipped by this spec directory rather than `seeded`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — gate rows render only while `awaiting` or `rejected`; decided and unreached gates leave the tree while their records stay in the detail pane; the intent row shows `→ N intents` when its artifact lists downstream inputs.
- `v2/docs/v1-behaviors.md` § TUI / observability — pipeline-tree bullet: stage kind resolved from the registry definition by `snapshot.name`, unregistered names eliding nothing, the gate render rule, the `→ N intents` suffix, and the `stale_non_targetable` change for approve/reject on a non-`awaiting` gate.
- `v2/spec/tui-command-center-brief.md` — seed table row 3 state.
