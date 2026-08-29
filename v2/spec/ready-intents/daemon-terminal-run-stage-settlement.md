---
name: daemon-terminal-run-stage-settlement
---

# Settle linked stages on terminal run events and daemon start

## Prerequisites

- Persistence idempotently maps terminal durable workflow rows onto every linked running stage, including terminal status, artifacts, publication evidence, and failure detail, while leaving live runs unchanged.
- Pipeline dispatch, adoption, and recovery use durable stage admission as the only same-row ownership guard.
- Linear, fan-out, and in-flight pipeline decisions use one canonical state derivation with existing precedence preserved.

## Module-boundary surface

- Daemon: terminal-run event handling, startup recovery, and operator resume semantics.

## Problem

The daemon settles stages by awaiting `workflowPromisesByEntryRunId`; adoption, restart, and quota-kill paths without that promise rely on deferred markers and manual or startup redrive exceptions.

## Decision ledger

- One daemon settlement owner invokes durable run-backed settlement after run-terminal events and during daemon startup; rules out terminal stages depending on the process that dispatched or adopted the run.
- In-process workflow promises may trigger earlier observation but never supply settlement truth; rules out promise results determining durable stage state.
- Settled stages resume ordinary successor dispatch or terminal publication through one continuation path; rules out settlement-specific progression forks.
- `settlement_deferred`, resume-driven redrive, and startup redrive predicates are removed after owner coverage lands; rules out keeping copy-then-reconcile escape hatches alongside durable settlement.

## Acceptance criteria

- [ ] The new `daemon-pipeline-start.test.ts` test `terminal entry runs settle linked stages with or without a local workflow promise` fails against the pre-fix promise-owned path and proves matching durable stage rows and artifact evidence for held, adopted, and startup-observed terminal runs.
- [ ] The terminal-event and startup continuation guard in `v2/src/daemon/daemon-pipeline-start.test.ts` — `terminal entry runs settle linked stages with or without a local workflow promise`; Mutation checkpoint:
- [ ] The new `daemon-pipeline-start.test.ts` test `terminal stage settlement continues a pipeline at most once` fails against the pre-fix separate continuation paths and proves repeated terminal handling and startup settlement are idempotent.
- [ ] No covered path writes `settlement_deferred`, and the marker plus resume/start redrive predicates are absent from production code.
- [ ] `pipeline_resume` no longer carries special deferred-settlement admission or the two-resume recovery choreography.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — single settlement ownership, terminal-event and startup coverage, promise role, and retired redrive paths.
- `v2/docs/operator-runbook.md` — remove deferred-settlement restart/resume recovery choreography.
- `v2/docs/v1-behaviors.md` — terminal run rows settle linked stages independent of daemon process continuity.
