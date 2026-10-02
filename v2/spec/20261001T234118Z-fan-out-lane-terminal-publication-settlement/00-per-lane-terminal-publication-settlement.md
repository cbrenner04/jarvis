# Per-lane terminal publication settlement

## Problem

`resolveTerminalPublicationInput` returns `multi-branch terminal publication is not defined for fan-out pipelines`, so `settlePipelineTerminalPublication` records pipeline-level `terminalPublicationFailure` while implement rows stay `succeeded`. Aggregate `derivePipelineState` becomes `failed` without per-lane publication, merge terminal action never runs, and sibling lanes cannot settle independently.

## Surface

`v2/src/daemon/pipeline-execution.ts` (`resolveTerminalPublicationInput`, `settlePipelineTerminalPublication`, `commitTerminalPublicationSuccessSafely` / `commitTerminalPublicationFailureSafely`, fan-out settlement hooks). Persistence already supports per-lane stamps and aggregation (`state-store.ts`, `state-store.test.ts` — fan-out terminal publication commits). Tests: `pipeline-execution.test.ts` (`pipeline terminal publication settlement`).

Out of scope: fan-out supersede (`01-fan-out-terminal-supersede-close.md` — do not invoke `settleSupersededPrecedingStagePrs` or fan-out close behavior; `findFanOutSplit` early return at ~1509 stays until 01), `pipeline resume` clearing `terminalPublicationFailure`, lane-pr-closed settlement shortcuts.

## Decisions

- Drop the fan-out early refusal in `resolveTerminalPublicationInput` and resolve input from each lane's final succeeded suffix workflow artifact via `finalSucceededWorkflowStageForBranch` (or equivalent shared helper) — rules out keeping the pipeline-only refusal reachable at `pipeline-execution.ts` ~1345.
- When a fan-out lane's authored suffix stages are satisfied, run terminal publication for that lane using that lane's implement (or last workflow) PR evidence without waiting for sibling lane stage order — rules out invoking publication only after `runConcurrently` finishes every suffix walk.
- Pass `branchKey` through `commitTerminalPublicationSuccess` / `commitTerminalPublicationFailure` on fan-out lanes so durable rows match `state-store` aggregation — rules out calling pipeline-only `commitTerminalPublicationSuccess({ pipelineId })` for fan-out.
- Pipeline `terminalPublicationSucceededAt` and aggregate `succeeded` remain all-lanes publication success; pipeline `terminalPublicationFailure` carries `branchKey` (or `branchKeys`) from store reconciliation — rules out treating the first lane failure as a non-lane-attributed pipeline failure while siblings keep publishing.
- For fan-out, `isPipelineSettlementPending` stays true while any admitted suffix lane lacks an artifact `terminalPublication` stamp, even when `pipeline.terminalPublicationFailure` is already set — rules out the `terminalPublicationFailure !== null` early return at ~1328 preventing sibling `executeTerminalPublication` after the first lane failure durably commits pipeline failure and `settlePipelineTerminalPublication` would otherwise return at ~1560.
- `deriveFanOutSuffixState` treats outstanding per-lane publication as `running` while suffix stages are otherwise settled — rules out `pipeline wait` returning terminal success when a lane still owes publication (reachable via `isPipelineSettlementPending` in `deriveFanOutSuffixState` ~3644).
- Idempotent re-entry: lanes with an existing artifact `terminalPublication` stamp are not re-published in the same settlement pass — rules out duplicate `executeTerminalPublication` on daemon restart continuation for settled lanes.

## Task checklist

- Extend `resolveTerminalPublicationInput` (or add a branch-scoped resolver) for fan-out lanes; remove the multi-branch refusal.
- Rework `settlePipelineTerminalPublication` to settle each fan-out lane whose suffix is satisfied and lacks a terminal publication stamp, invoking `executeTerminalPublication` per lane and committing with `branchKey`.
- Hook lane settlement from the fan-out suffix execution path so a lane can publish when its suffix completes, not only at the end of `runPipeline`.
- Thread `branchKey` through safe commit helpers; leave fan-out supersede unwired on the per-lane success path (subspec 01).
- Add `pipeline-execution.test.ts` regressions: two-lane fan-out with `terminalAction: "ready"` (per-lane publication, aggregate success, no refusal message); same with `terminalAction: "merge"` (one `executeTerminalPublication` per lane against that lane's implement evidence); one lane publication failure where the sibling lane's `executeTerminalPublication` runs only after the failing lane's failure is durably committed (second settlement pass or suffix hook), not solely by publishing both lanes before any pipeline-level failure exists.
- Rewrite `fan-out with terminalAction fails closed instead of reporting succeeded` (~7395) for post-refusal behavior (per-lane publication expectations instead of the multi-branch refusal message).
- Update `v2/docs/pipeline-execution.md` (remove fan-out refusal; document per-lane publication and aggregation) and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `pipeline-execution.test.ts`: a two-lane fan-out whose implements both succeed runs terminal publication per lane, derives `succeeded` with `terminalPublicationSucceededAt` set, and does not commit `multi-branch terminal publication is not defined for fan-out pipelines`; fails against the current fan-out refusal.
- [x] Same surface with `terminalAction: "merge"`: mocked `executeTerminalPublication` runs once per settled lane against that lane's implement PR evidence, per-lane and pipeline durable rows record success, and derived state is `succeeded`; fails against the current fan-out refusal.
- [x] Same surface: one lane's publication failure is durable on that lane's row, the sibling lane still succeeds, and derived state is `failed` naming the failing lane; the regression must invoke the sibling lane's `executeTerminalPublication` only after the failing lane's pipeline-level `terminalPublicationFailure` is committed (mock or staged settlement), not by publishing both lanes in one pass before any failure exists; fails against pre-fix pipeline-only failure attribution and against today's ~1328/~1560 early-return path.
- [x] `pipeline-execution.test.ts`: two-lane fan-out with both implements succeeded and terminal publication not yet committed keeps `derivePipelineState` `running` until every lane's publication stamp settles; fails against reporting `succeeded` or lane-attributed `failed` while a sibling still owes publication; reachable on `isPipelineSettlementPending` in `deriveFanOutSuffixState` (~3644).
- [x] `pipeline-execution.test.ts` — `does not supersede when policy is keep, terminal action is leave-draft, or fan-out refuses terminal success` (keep and leave-draft portions only) stays green.
- [x] `bun run typecheck` exits zero.
- [x] `bun run test:v2` exits zero.

## Documentation updates

- `v2/docs/pipeline-execution.md` — per-lane fan-out terminal publication, aggregation of `terminalPublicationSucceededAt` / `terminalPublicationFailure`, and removal of the fan-out refusal boundary.
- `v2/docs/v1-behaviors.md` — record per-lane fan-out terminal publication and pipeline-level aggregation (revise the entry that still implies refusal if present).
