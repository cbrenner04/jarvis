# Pipeline dispatch stale-reset through shared preparation

Authoritative for pipeline dispatch stale-reset through shared preparation: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`pipeline-execution.ts` runs stale-reset preflight only for intent workflow stages via `resetStaleIntentWorkspaceIfNeeded`, synthetic `IntentWorkflowCliInput`, and `maybeResetStaleWorkspace` outside `prepareWorkflowStart`. Plan, implement, single-stage non-intent paths, and fan-out branch dispatch skip the shared gate and can re-dispatch on poisoned worktrees.

## Decision ledger

- Run `runStaleResetPreflight` from shared preparation before every workflow stage dispatch (single-stage and fan-out); rules out intent-only `resetStaleIntentWorkspaceIfNeeded` gating on `stage.workflow === "intent"`.
- Represent pipeline stale-reset policy as normalized `WorkflowStartPreparationRequest.staleReset.flags` (default: both skip flags false); rules out `SYNTHETIC_INTENT_PARSED_INPUT` and argv-shaped CLI parse stubs.
- Record stage `failed` with the captured preflight message when stale-reset refuses, without calling `dispatchPipelineStage`; rules out dispatch after a refused preflight.
- Deferred to first consumer: whether pipeline admission exposes operator `--reset-despite-*` equivalents on persisted context — pin when a caller needs non-default skip flags beyond the default both-false policy.

## Tasks

- Extend the pipeline preparation adapter so dispatch can obtain `runStaleResetPreflight` from the same `prepareWorkflowStart` result used for step assembly.
- Replace `resetStaleIntentWorkspaceIfNeeded` and `intentStaleReset` injection with shared preparation preflight in `advanceWorkflowStage`, fan-out branch dispatch, and daemon deps wiring.
- Delete `SYNTHETIC_INTENT_PARSED_INPUT` and intent-only stale-reset helpers once unreachable.
- Add regressions proving plan, implement, single-stage, and fan-out paths refuse dispatch when stale-reset fails; update the existing intent stale-reset regression to assert the shared gate.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `pipeline plan-stage stale-reset refusal fails stage without dispatch` drives a plan workflow stage through shared preparation preflight with a refusing stale-reset fixture and asserts the stage records `failed` with no workflow dispatch; it fails against the pre-fix intent-only gate reachable in `pipeline-execution.ts`.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `pipeline implement-stage stale-reset refusal fails stage without dispatch` drives an implement workflow stage through shared preparation preflight with a refusing fixture and asserts the stage records `failed` with no workflow dispatch; it fails against the pre-fix intent-only gate.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `pipeline intent-stage stale-reset refusal fails stage without dispatch` asserts the shared preparation stale-reset gate runs (not the synthetic argv path) and still records `failed` without dispatch on refusal; it fails against `SYNTHETIC_INTENT_PARSED_INPUT` reachable in `pipeline-execution.ts`.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `pipeline fan-out stale-reset refusal fails branch without dispatch` drives a fan-out branch dispatch through shared preparation preflight with a refusing fixture and asserts the branch stage records `failed` with no workflow dispatch; it fails against fan-out dispatch skipping stale-reset in `runFanOutBranchAction`.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `approving both fan-out branches dispatches each successor on its own branchKey` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None in this slice; durable docs land in `02-preparation-parity-structural-authority-and-docs.md`.
