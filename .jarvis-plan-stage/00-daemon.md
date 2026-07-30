# Daemon

## Problem

Operators cannot launch daemon-owned pipelines from the CLI.

## Prerequisites

- `resolveProjectPipeline` validates project pipeline configuration before admission effects (`v2/src/execution/project-pipeline-resolution.ts`, `implement-workflow-steps.ts`).
- `pipeline_start` durably admits a validated definition and returns `{ pipelineId }` (`v2/src/daemon/daemon-pipeline-start.test.ts`).
- Admitted pipeline execution continues after the admitting client disconnects (`daemon-pipeline-start.test.ts`).

## Decisions

- Add top-level `jarvis pipeline start <project> (--seed <path> | --seed-text <text>) [--detach]`; rules out nesting under `jarvis run` or inferring pipeline progress from `jarvis run list`.
- Resolve the registered `<project>`, require a `pipeline` object, load machine `agentModelConfig`, and run `resolveProjectPipeline` before any daemon connection or `pipeline_start`; rules out rejecting configuration after durable rows exist.
- Reuse implement's `formatProjectPipelineResolutionError` stderr shape (`<code>: …`); rules out a pipeline-specific error vocabulary.
- Require exactly one of `--seed` or `--seed-text` (mutually exclusive, same contract as `jarvis run workflow intent`); rules out an optional seed.
- On valid configuration, connect to the keyed daemon and call `pipeline_start` with the resolved definition plus `PipelineContext` `{ cwd: invocation cwd, seed, configPath, projectRegistry }`; rules out re-validating inside the daemon handler.
- Success prints the admitted pipeline ID alone on stdout as the first stdout line; rules out hiding the ID behind JSON wrappers.
- `--detach` returns exit `0` immediately after printing the admitted ID; rules out client-side `pipeline_wait` or implying detach observed completion.
- Default attached mode prints the same admitted ID, then blocks on `pipeline_wait` until `{ kind: "terminal", state }`, continuing through `awaiting-approval` boundaries without returning; rules out returning on admission or at an approval gate.
- Attached terminal completion appends one minified JSON stdout line `{kind:"terminal",state}` and an exit code keyed to `state` (`succeeded` → `0`, other terminal states → `1`); rules out a silent attach exit or a second pipeline ID line.
- Failed pre-admission resolution and failed daemon admission exit non-zero with stderr detail and no pipeline ID on stdout; rules out partial success on validation or RPC refusal.
- CLI-only; no daemon `pipeline_start`, observation, or execution-loop changes.

## Task checklist

- Register `jarvis pipeline` in `command-tree.ts`, `cli.ts`, and `usage.ts` with `start` subcommand help.
- Implement `v2/src/commands/pipeline.ts` (or equivalent) for `pipeline start` arg parsing, pre-admission resolution, detach/attach branching, and IPC wiring.
- Add focused coverage in `v2/src/commands/pipeline.test.ts` for valid start, invalid pre-admission config, detach, attached terminal wait-through-approval, failed admission, and test seams for guard inversion.
- Document start syntax, stdout, exit codes, and attach/detach semantics in `v2/docs/write-behavior.md` and launch workflows in `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` fails on baseline and then shows valid `pipeline start` printing its admitted ID, while invalid project pipeline configuration exits non-zero before daemon connection or durable effects.
- [ ] The attach/detach regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then proves `--detach` exits `0` after admission while attached start remains blocked until terminal, including through an `awaiting-approval` boundary, and emits terminal JSON plus the exit code contract above.
- [ ] Inverting the pre-admission resolution guard or the detach client-wait guard makes `v2/src/commands/pipeline.test.ts` fail; negative cases prove invalid configuration reaches the operator before daemon IPC and detach performs no `pipeline_wait`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.


## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis pipeline start` syntax, stdout (admitted ID; attached terminal JSON), exit codes, pre-admission failure boundary, and attach/detach semantics.
- `v2/docs/operator-runbook.md` — launching pipelines, detach vs attached observation, and that detach exit `0` means admitted not finished.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only pipeline start CLI.
