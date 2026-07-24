---
name: workflow-attached-waits-for-terminal
---

# Attached workflow launch exits only when the workflow is terminal

## Problem

Attached `jarvis run workflow` can exit zero with the first constituent run's completion JSON while later steps continue under other run IDs — operators misread this as a finished workflow with no PR.

## Decisions

- Default attached launch blocks until the **workflow entry** run is terminal, not until the first child run completes; rules out reusing today's single-run `wait` completion as the command outcome.
- Final stdout JSON and process exit code describe the workflow entry outcome; rules out mirroring an intermediate step run's status.
- Builds on terminal workflow failure rollup from `20260721T115738Z-workflow-command-reports-terminal-workflow-failure` (attach duration and CLI outliving multi-row workflows only — not re-litigating rollup semantics).
- Failed admission unchanged; rules out changing validation or `start` error surfaces in this slice.
- CLI attachment only; rules out changing daemon step scheduling or workflow execution.

## Acceptance criteria

- [ ] A regression test in `workflow.test.ts` uses a multi-row workflow fixture, keeps the real CLI process attached (no mocked early exit), and asserts the process has not exited until the workflow entry run reaches a terminal state; it fails against pre-fix code that exits on the first constituent `wait`.
- [ ] The attached command's final minified JSON line and exit code match the workflow entry's terminal outcome, not an intermediate run's.
- [ ] A failed admission still exits non-zero with the existing named failure.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — attached workflow wait semantics and completion JSON meaning.
- `v2/docs/operator-runbook.md` — exit zero on attached launch means the workflow finished, not merely the first step.
- `v2/docs/v1-behaviors.md` — update the `jarvis run workflow` attachment bullet to match workflow-terminal wait.

## Prerequisites

- Spec `20260721T115738Z-workflow-command-reports-terminal-workflow-failure` merged (workflow entry terminal failure rollup).
- Intent `workflow-print-run-id-at-admission` implemented (admission run ID precedes attach wait stdout).
