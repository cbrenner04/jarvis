---
name: pipeline-dispatch-threads-project-ready-and-fix-commands
---

# Daemon pipeline dispatch drops the entire step-config layer the CLI applies (readyCommand, fixCommand, iteration bounds, review timeouts)

## Problem

Every workflow write/review step's project- and machine-config layer is stamped in exactly one place — `prepareWorkflowSteps` (`v2/src/commands/workflow.ts:226`, wiring at `:242–264`) — which is on the **CLI `run workflow` path only** (`workflow.ts:380`, `:390`). The **daemon pipeline-stage dispatch never calls it**: `resolveStageWorkflowSteps` (`pipeline-stage-resolve.ts:535`) → `defaultPipelineDispatch` (`daemon.ts:2000`) → `handleWorkflowStart` → `startWorkflowRun` (`daemon.ts:1184`), and `startWorkflowRun` maps each step adding **only** `signal` (`daemon.ts:1201`). The shared builders/loader set none of it either. So all five config values arrive `undefined` on daemon-dispatched steps and silently fall back to defaults:

| Config (source) | Default when missed | Impact on a pipeline run |
| --- | --- | --- |
| write `iterationTimeoutMs` (`...bounds`) | `DEFAULT_ITERATION_TIMEOUT_MS` 10min | configured per-iteration timeout ignored |
| write `iterationCeilingMs` (`...bounds`) | `undefined` → **no ceiling watchdog armed** (`write-loop.ts:2056`, gated on `!== undefined`) | **no absolute wall-clock kill on a pipeline write step** — diverges even at default config |
| write `idleOutputMs` (`...bounds`) | `undefined` → **no idle-output watchdog armed** (`write-loop.ts:2423`, gated on `!== undefined`) | **a stalled pipeline agent producing no output is never caught** — diverges even at default config |
| write `fixCommand` (`readProjectFixCommand`) | `bun run fix` (`shared/fix-command.ts:50`) | ready-gate autofix runs the wrong command |
| write `readyCommand` (`readProjectReadyCommand`) | `bun run ready` (`ready-finalize.ts:44`) | ready gate runs `bun run ready`, not the configured command |
| review `roleTimeoutMs` (`readReviewRoleTimeoutMs`) | 30min | configured review-role timeout ignored |
| review `idleOutputMs` (`readConfiguredIdleOutputTimeoutMs`) | 90s | configured review idle-output timeout ignored |

The two unarmed write-step watchdogs (ceiling + idle-output) are the most severe: a daemon-dispatched implement/plan that stalls or runs away is never force-terminated, unlike the CLI path — a likely cause of hanging pipeline runs, and it inverts the "idle_output_timeout false-kills pipelines under contention" folklore (the CLI path arms that watchdog; pipelines never did).

Observed 2026-08-29, `cbrenner04/chess-mvp-yolo` (config `readyCommand: "make test"`, no `bun run ready` script), pipeline `7089b156` `fast` implement `~shrink` run `c990d3d5`: settled `ready_gate_command_missing`, `error.message: "Ready gate command missing: bun run ready\nerror: Script not found \"ready\""` — `bun run ready`, not the configured `make test`. Every chess implement red-gates this way, blocking pipeline dogfooding.

Secondary defect: the one daemon-side path that does re-read project config, `inertResumeWriteLoopInput` (`workflow-runner.ts:3478`, intent-finalization resume), calls `readProjectFixCommand`/`readProjectReadyCommand` with the **default `MACHINE_CONFIG_PATH`**, not the pipeline's `context.configPath`.

Not a divergence (verified, leave alone): the #3049 intent/plan ready-gate skip keys off `promptId`/`landing`, which the shared builders set on both paths, so it works identically under pipeline dispatch.

## Decisions

- Thread all five config values onto daemon-dispatched write/review steps exactly as `prepareWorkflowSteps` does: write steps get `resolveWritePathIterationBounds` (`iterationTimeoutMs`/`iterationCeilingMs`/`idleOutputMs`), `readProjectFixCommand`, `readProjectReadyCommand`; review/review-debate steps get `readReviewRoleTimeoutMs` and `readConfiguredIdleOutputTimeoutMs`. Resolve from the **pipeline's own `configPath`**, not the default. Rules out the config layer reaching only the CLI path, and rules out a partial fix that wires `readyCommand` alone.
- Unify so CLI and daemon dispatch cannot diverge again: the step-config stamping moves to a single shared function both paths call (extract the `prepareWorkflowSteps` mapping core, or stamp inside the shared builders/loader), rather than a second copy inside the daemon. Rules out re-introducing the drift with a duplicated mapping.
- Fix the secondary path: `inertResumeWriteLoopInput` resolves fix/ready commands from the run's actual config path.
- Do not change default behavior for a project with no configured value: absent `readyCommand`→`bun run ready`, absent `fixCommand`→`bun run fix`, bounds/timeouts→their existing defaults, and the watchdogs arm from the resolved bounds. Rules out forcing values where none are configured (but the ceiling/idle-output watchdogs must now arm on the daemon path from resolved bounds, since resolved bounds carry them).

## Acceptance criteria

- [ ] A daemon/pipeline-dispatch test drives an implement step for a project whose machine config sets `readyCommand` and `fixCommand` to non-default values and asserts the write step carries them (and the ready gate resolves the configured command, not `bun run ready`) — fails against the current daemon path.
- [ ] The same dispatch stamps `iterationTimeoutMs`, `iterationCeilingMs`, and `idleOutputMs` from resolved write-path bounds so the ceiling and idle-output watchdogs arm on a daemon write step — pinned by a test asserting the step carries the bounds (fails today: bounds absent → watchdogs unarmed).
- [ ] Review/review-debate steps dispatched by the daemon carry the configured `roleTimeoutMs` and `idleOutputMs` — pinned by a test.
- [ ] CLI `run workflow` and daemon pipeline dispatch stamp all five values through a single shared point (no duplicated mapping) — pinned by a test or structural assertion.
- [ ] A project with no configured `readyCommand`/`fixCommand` still resolves `bun run ready`/`bun run fix` on the daemon path, and bounds/timeouts fall back to their documented defaults — pinned by a test.
- [ ] `inertResumeWriteLoopInput` resolves fix/ready commands from the run's config path, not the default `MACHINE_CONFIG_PATH` — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — configured `readyCommand`/`fixCommand`/iteration bounds/review timeouts apply to pipeline-dispatched runs, not only CLI `run workflow`.
- `v2/docs/daemon-host.md` — pipeline-stage dispatch stamps the shared step-config layer (commands, bounds, watchdogs, review timeouts) from the pipeline's config path; note the ceiling/idle-output watchdogs now arm on daemon write steps.
