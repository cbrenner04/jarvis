# Admission binding

## Problem

The monitor has no production detached-admission seam, so `submitCommand` cannot reach the same `pipeline_start` path as `jarvis pipeline start`.

## Prerequisites

- `admitPipelineStart` owns validated one-request admission and returns before `pipeline_wait`.
- The monitor retains command editor state, paints four dock rows, and routes focused Enter once through `submitCommand`.

## Decisions

- Bind a detached `admitPipelineStart` callback at the TUI entry boundary from invocation cwd, machine config, project registry/model loaders, pipeline resolver, and auto-start connection/request seams used by `jarvis pipeline start` — rules out invoking the CLI adapter or duplicating pre-admission policy in monitor controls.
- Expose that callback to `runTuiEntry` without moving CLI presentation or `pipeline_wait` into the TUI — rules out blocking Ink or attaching the monitor to completion.

## Work

- Wire production `admitPipelineStart` into `runTuiEntry` through injectable monitor deps.
- Add command-boundary pinning in `v2/src/commands/tui.test.ts`.

## Acceptance criteria

- [x] `v2/src/commands/tui.test.ts` adds a regression that fails against the baseline and proves `jarvis tui` supplies monitor controls whose detached admission uses `admitPipelineStart` with the same cwd, config, registry, model, pipeline-resolution, auto-start connection, and `pipeline_start` seams as `jarvis pipeline start`, with no `pipeline_wait` and no duplicate pre-admission checks.
- [x] `v2/src/commands/tui.test.ts` carries a valid `// @mutate` directive for every added or modified admission-binding guard; inverting each real source condition turns its pin red, and production has no inversion hook.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None.
