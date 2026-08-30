# CLI delegates workflow-start preparation

## Problem

`runWorkflowCommand` privately builds preset input, invokes builders, stamps machine config through `prepareWorkflowSteps`, and sequences `maybeResetStaleWorkspace` before daemon `start`. Even after subspec 00 centralizes realizability and posture-to-preset tables, pipeline dispatch still cannot reuse the complete CLI preparation contract without copying builder, stamp, and stale-reset sequencing.

## Decision ledger

- Extend the shared owner with a normalized workflow-start request, builder invocation, `stampWorkflowStepsWithMachineConfig`, and stale-reset preflight; rules out keeping `prepareWorkflowSteps` and `maybeResetStaleWorkspace` as separate production authorities beside the shared call target.
- `runWorkflowCommand` adapts parsed argv into one shared preparation call and keeps usage selection, legacy-alias warnings, detach, implement recovery, daemon connection, output, and wait handling; rules out leaking operator transport semantics into shared preparation.
- Preset build and machine-config stamp failures stay before daemon connection; stale-reset preflight stays inside the connected dispatch scope immediately before daemon `start`; rules out auto-starting a daemon for an invalid build or bypassing daemon-backed stale-workspace claims.
- The shared result retains built preset metadata and destroyed-artifact evidence for the CLI retirement summary; rules out re-reading unstamped builder output or moving stderr summary formatting into shared preparation.
- Deferred to first consumer: daemon pipeline dispatch adaptation, fan-out stale-reset policy normalization, and stage-failure settlement on stale-reset refusal — pin when `dispatch-pipeline-stages-through-shared-preparation` consumes shared preparation.

## Task checklist

- Add normalized request/result types and the full preparation entrypoint composing preset builders, stamping, and stale-reset preflight.
- Refactor `runWorkflowCommand` to delegate preparation to that entrypoint while retaining recovery and transport behavior in the command adapter.
- Add a parameterized regression proving representative `intent`, `plan`, and `implement` CLI requests reach the shared target once and send unchanged built-and-stamped steps to daemon `start`.
- Add a structural regression proving `runWorkflowCommand` no longer owns inline build, stamp, or stale-reset logic outside the shared entrypoint.
- Update `v2/docs/v2-architecture.md`, `v2/docs/workflow-runner.md`, `v2/docs/pipeline-execution.md`, and `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] A new regression in `v2/src/commands/workflow.test.ts`, `run workflow intent plan and implement preserve prepared start steps through the shared owner`, fails against the pre-fix private command path and proves each parsed CLI request reaches the shared preparation target once and sends the unchanged built-and-stamped step array to daemon `start`.
- [x] `v2/src/commands/workflow.test.ts` tests `run workflow implement resets a stale worktree before daemon start`, `run workflow plan resets a stale worktree before daemon start`, and `run workflow intent resets a stale worktree before daemon start` stay green; build/stamp refusal remains pre-connect and stale reset remains after connect but before `start`.
- [x] A structural test in `v2/src/commands/workflow.test.ts` proves `runWorkflowCommand` delegates preset build, step stamping, and stale-reset preflight to the shared preparation entrypoint; it fails against the pre-fix private `prepareWorkflowSteps` and direct `maybeResetStaleWorkspace` call sites reachable from `runWorkflowCommand`.
- [x] `v2/src/commands/workflow.test.ts` tests `recovery uses the implement completion traversal and canonical spec identity`, `run workflow implement detaches an admitted recovery`, `run workflow intent with --detach prints intent paths stderr before run ID without client wait`, and `run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON` stay green.
- [x] `v2/docs/v2-architecture.md` defines the shared workflow-start preparation boundary and thin CLI adapter; `v2/docs/workflow-runner.md` assigns normalized realization, build, stamp, and stale-reset ownership before daemon admission; `v2/docs/pipeline-execution.md` documents shared authority while merge-day daemon assembly remains pending migration; `v2/docs/v1-behaviors.md` records unchanged standalone workflow-start ordering and operator semantics through the shared boundary.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — shared workflow-start preparation boundary and thin CLI adapter.
- `v2/docs/workflow-runner.md` — normalized preparation ownership before daemon admission.
- `v2/docs/pipeline-execution.md` — shared realizability/preset authority while merge-day daemon assembly remains pending migration.
- `v2/docs/v1-behaviors.md` — unchanged CLI workflow-start semantics through shared preparation.
