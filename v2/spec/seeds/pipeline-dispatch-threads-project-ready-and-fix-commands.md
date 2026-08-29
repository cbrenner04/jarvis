---
name: pipeline-dispatch-threads-project-ready-and-fix-commands
---

# Pipeline-dispatched implement ignores the project's configured readyCommand/fixCommand and defaults to `bun run ready`

## Problem

A project's configured `readyCommand` (and `fixCommand`) reach a workflow's write steps only through `prepareWorkflowSteps` (`v2/src/commands/workflow.ts:226`, wiring at `:258–264`), which is called **only on the CLI `run workflow` path** (`workflow.ts:380`, `:390`). The **daemon's pipeline-stage dispatch never calls `prepareWorkflowSteps` and sets `readyCommand`/`fixCommand` nowhere** (`git grep readyCommand v2/src/daemon` is empty). So a pipeline-dispatched implement step — and the `~shrink` pass that inherits it via `{ ...step }` (`runShrinkAfterImplementComplete`, `workflow-runner.ts`) — runs the ready gate with `readyCommand` undefined, which `resolveReadyGateCommand` (`ready-finalize.ts:48`) defaults to `bun run ready`.

For any project whose configured `readyCommand` is not `bun run ready`, every pipeline implement stage runs the wrong gate command and (when no `bun run ready` script exists) settles `ready_gate_command_missing`, never running the configured command. The configured `readyCommand` is silently ignored on the exact path pipelines use.

Observed 2026-08-29, `cbrenner04/chess-mvp-yolo` (config `readyCommand: "make test"`), pipeline `7089b156` `fast` implement stage: the `~shrink` run `c990d3d5` settled `loopOutcomeKind: ready_gate_command_missing`, `error.message: "Ready gate command missing: bun run ready\nerror: Script not found \"ready\""` — `bun run ready`, not the configured `make test`. Every chess implement red-gates this way, blocking pipeline dogfooding.

`fixCommand` rides the same gap (also only set in `prepareWorkflowSteps`), so daemon-dispatched autofix uses the default fix command too. The review-bound parity (`roleTimeoutMs`, `idleOutputMs`) that `prepareWorkflowSteps` also applies may diverge on the daemon path as well — verify while fixing.

## Decisions

- The daemon's pipeline-stage (and any daemon-dispatched) implement/write step construction resolves the project's `readyCommand` and `fixCommand` from machine config (`readProjectReadyCommand`/`readProjectFixCommand`) and threads them onto the write step, matching `prepareWorkflowSteps`; rules out the configured command reaching only the CLI path. The `~shrink` step inherits both through its existing `{ ...step }` spread — no separate shrink wiring needed once the implement step carries them.
- Resolve the shared step-preparation so CLI and daemon dispatch cannot diverge again — either both call `prepareWorkflowSteps` (or the command-resolving core of it) or the readyCommand/fixCommand wiring moves to a single point both paths pass through; rules out a second copy of the wiring that can drift.
- Do not change default behavior for a project with no configured `readyCommand`: it still defaults to `bun run ready`; rules out forcing a command where none is configured.

## Acceptance criteria

- [ ] A daemon/pipeline-dispatch test drives an implement (and its `~shrink` pass) for a project whose machine config sets `readyCommand` to a non-default value and asserts the ready gate resolves/runs that configured command, not `bun run ready` — fails against the current daemon path that leaves `readyCommand` undefined.
- [ ] The same dispatch threads the configured `fixCommand` onto the step — pinned by a test.
- [ ] A project with no configured `readyCommand` still resolves `bun run ready` on the daemon path — pinned by a test.
- [ ] CLI `run workflow` and daemon pipeline dispatch resolve `readyCommand`/`fixCommand` through a single shared point (no duplicated wiring) — pinned by a test or a structural assertion.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — the configured `readyCommand`/`fixCommand` applies to pipeline-dispatched implements, not only CLI `run workflow`.
- `v2/docs/daemon-host.md` — pipeline-stage dispatch resolves project ready/fix commands from machine config.
