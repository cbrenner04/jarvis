# Daemon pipeline dispatch stamping

## Problem

Pipeline stage resolution (`resolveStageWorkflowSteps`) feeds preset-builder output straight into `dispatchPipelineStage` → `defaultPipelineDispatch` → `handleWorkflowStart` (`daemon.ts:2000–2007`, `startWorkflowRun` at `:1201` adds only `signal`). Daemon-dispatched write steps therefore miss configured `fixCommand`/`readyCommand`, write-path iteration bounds (ceiling and idle-output watchdogs stay unarmed), and review `roleTimeoutMs`/`idleOutputMs` — reachable on main today when a pipeline admitted with non-default machine config runs `bun run ready` instead of the configured ready command.

## Decision ledger

- Stamp resolved workflow steps through the shared export from subspec 00 immediately before `dispatchPipelineStage`, using the pipeline admission snapshot's `context.configPath`; rules out re-reading default `MACHINE_CONFIG_PATH` on the daemon path and rules out stamping inside `defaultPipelineDispatch`, which has no config path.
- Thread `configPath` on the `advanceWorkflowStage` → `dispatchPipelineStage` seam (or an adjacent pre-dispatch helper both paths call); rules out inferring config from `MACHINE_CONFIG_PATH` when `context.configPath` is absent — fail the stage with the same loader error shape the CLI would surface.
- Unconfigured `readyCommand`/`fixCommand` still resolve at execution to `bun run ready` / `bun run fix`; bounds and review timeouts fall back to documented defaults — same semantics as CLI admission.
- Ready-gate skip for markdown-only intent/plan stages stays keyed off builder `promptId`/`landing`; no change in this slice.

## Task checklist

- After stage resolution and any stale-reset preflight, stamp `resolvedSteps` with the shared export and `context.configPath` before `dispatchPipelineStage` in `pipeline-execution.ts` (fan-out resolutions stamp each result set the same way).
- Add `pipeline-stage-dispatch.test.ts` coverage for configured write commands, write-path bounds, review timeouts, and unconfigured fallbacks.
- Add keystone and guard `@mutate` directives on the pinning tests.
- Update `v2/docs/install-and-config.md`, `v2/docs/daemon-host.md` (replace the deferred-vs-CLI paragraph at the pipeline launch section), and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/pipeline-stage-dispatch.test.ts` drives an implement-stage dispatch for a project whose machine config sets non-default `readyCommand` and `fixCommand` and asserts the dispatched write step carries both; it fails against the pre-fix daemon path that forwards raw preset output. `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `dispatches implement write steps with configured fix and ready commands`; Mutation checkpoint: its test body carries `// @mutate` reverting the pre-dispatch stamp call so raw resolved steps reach `dispatch`, and the mutation turns that test RED.
- [ ] A sibling test in `v2/src/daemon/pipeline-stage-dispatch.test.ts` asserts dispatched write steps carry `iterationTimeoutMs`, `iterationCeilingMs`, and `idleOutputMs` from resolved write-path bounds; it fails against the pre-fix path where those fields are absent on daemon-dispatched steps.
- [ ] A test in `v2/src/daemon/pipeline-stage-dispatch.test.ts` asserts daemon-dispatched `review` and `review-debate` steps carry configured `roleTimeoutMs` and `idleOutputMs`; it fails against the pre-fix path.
- [ ] A test in `v2/src/daemon/pipeline-stage-dispatch.test.ts` asserts a project with no configured `readyCommand`/`fixCommand` still yields write steps whose execution resolves `bun run ready`/`bun run fix` and whose bounds/timeouts match documented defaults; the negative case proves absent optional fields are not forced onto the step object.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `dispatches implement write steps with configured fix and ready commands`; Keystone checkpoint: its test body carries `// @mutate` reverting the pre-dispatch stamp call so raw resolved steps reach `dispatch`, and the mutation turns that test RED while the unconfigured-fallback test stays green.
- [ ] `v2/docs/install-and-config.md` — `fixCommand`, `readyCommand`, write-path iteration bounds, and `reviewRoleTimeoutMs`/`idleOutputTimeoutMs` apply to pipeline-dispatched runs, not only CLI `run workflow`.
- [ ] `v2/docs/daemon-host.md` — pipeline-stage dispatch stamps the shared step-config layer from the pipeline admission `configPath`, replacing the deferred-vs-CLI prose.
- [ ] `v2/docs/daemon-host.md` — the ceiling and idle-output watchdogs arm on daemon write steps.
- [ ] `v2/docs/v1-behaviors.md` — pipeline-dispatched workflow steps receive the same machine-config stamping as CLI `run workflow`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — pipeline dispatch honors the same per-project commands and machine-config timeouts/bounds as CLI workflow admission.
- `v2/docs/daemon-host.md` — remove deferred-vs-CLI stamping gap; document pre-dispatch stamping from admission `configPath`.
- `v2/docs/v1-behaviors.md` — parity entry for pipeline-dispatched step-config stamping.

## Implementer notes

- `advanceWorkflowStage` already holds `context.configPath` from the durable pipeline row; fan-out paths in `advanceFanOutStageResolution` / `advanceFanOutBranches` need the same stamp before their `dispatchPipelineStage` calls.
- Pin `@mutate` anchors on the actual pre-dispatch stamp invocation once landed (one unique line in `pipeline-execution.ts`).
- Tests may capture dispatched steps via a `PipelineWorkflowDispatch` spy in `pipeline-stage-dispatch.test.ts` fixtures or a thin `advanceWorkflowStage` harness; assert step fields, not gate spawn, unless a ready-gate integration test already exists nearby.
