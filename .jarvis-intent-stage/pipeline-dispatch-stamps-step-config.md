---
name: pipeline-dispatch-stamps-step-config
---

# Pipeline dispatch stamps workflow step config

## Prerequisites

- Built workflow preset steps can be stamped with machine-config values through one shared export used by CLI `prepareWorkflowSteps`.

## Problem

Pipeline stage resolution dispatches raw preset-builder output: `resolveStageWorkflowSteps` → `defaultPipelineDispatch` → `startWorkflowRun` adds only `signal`, so configured `readyCommand`/`fixCommand`, write-path iteration bounds, and review timeouts are absent on daemon-dispatched steps and silently fall back — including unarmed ceiling and idle-output watchdogs on write steps.

## Behavior

Before pipeline workflow dispatch, stamp resolved steps through the shared step-config function using the pipeline admission snapshot's `configPath` (not the default machine-config path). Write steps carry resolved iteration bounds and project fix/ready commands; review and review-debate steps carry resolved `roleTimeoutMs` and configured idle-output timeout. Projects with no configured commands still resolve `bun run ready`/`bun run fix` at execution time; bounds and review timeouts fall back to documented defaults.

## Decisions

- Stamp at pipeline dispatch using the pipeline's own `context.configPath` — rules out re-reading from `MACHINE_CONFIG_PATH` or CLI-only `prepareWorkflowSteps`.
- Call the same shared stamping export the CLI uses — rules out a daemon-local duplicate mapping.
- Do not change default behavior for unconfigured projects beyond arming write-step watchdogs from resolved bounds (today absent on the daemon path) — rules out inventing new defaults.

## Acceptance criteria

- [ ] A daemon/pipeline-dispatch test drives an implement step for a project whose machine config sets non-default `readyCommand` and `fixCommand` and asserts the dispatched write step carries them and the ready gate resolves the configured command, not `bun run ready` — fails against the current daemon path.
- [ ] The same dispatch stamps `iterationTimeoutMs`, `iterationCeilingMs`, and `idleOutputMs` from resolved write-path bounds on the write step — pinned by a test; fails today when bounds are absent.
- [ ] Review and review-debate steps dispatched by the daemon carry configured `roleTimeoutMs` and `idleOutputMs` — pinned by a test.
- [ ] Daemon pipeline dispatch stamps all five config layers through the shared export with no duplicate mapping — pinned by a structural test or import assertion.
- [ ] A project with no configured `readyCommand`/`fixCommand` still resolves `bun run ready`/`bun run fix` on the daemon path and bounds/timeouts fall back to documented defaults — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — configured `readyCommand`/`fixCommand`/iteration bounds/review timeouts apply to pipeline-dispatched runs, not only CLI `run workflow`.
- `v2/docs/daemon-host.md` — replace the deferred-vs-CLI prose: pipeline-stage dispatch stamps the shared step-config layer from the pipeline's config path; ceiling and idle-output watchdogs arm on daemon write steps.
