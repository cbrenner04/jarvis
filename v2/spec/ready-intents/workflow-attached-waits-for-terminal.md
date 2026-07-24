---
name: workflow-attached-waits-for-terminal
---

# Attached workflow launch exits only when the workflow is terminal

## Problem

Daemon entry `wait` already awaits workflow-terminal rollup on main, but `workflow.test.ts` only exercises mocked single `wait` frames — a client that exited after the first constituent row would still pass. Operator docs still describe attached `jarvis run workflow` returning on the first constituent run, so the CLI contract is unguarded and misdocumented.

## Decisions

- Default attached launch blocks until the **workflow entry** run is terminal, not until the first child run completes; rules out reusing today's single-run `wait` completion as the command outcome.
- Final stdout JSON and process exit code describe the workflow entry outcome; rules out mirroring an intermediate step run's status.
- Builds on workflow-entry terminal failure rollup already shipped; rules out re-litigating rollup semantics in this slice.
- Failed admission unchanged; rules out changing validation or `start` error surfaces here.
- CLI attachment only; rules out changing daemon step scheduling or workflow execution.

## Acceptance criteria

- [ ] A new regression in `workflow.test.ts` uses a multi-row workflow daemon fixture, keeps the real attached CLI process (no mocked early exit), and asserts the process has not exited while a second constituent row is still non-terminal and only exits after the workflow entry run is terminal; fails if the client stops waiting after the first constituent completion.
- [ ] The same test asserts final stdout minified JSON and exit code match the workflow entry terminal rollup, not an intermediate constituent row.
- [ ] Failed admission preserved: `workflow.test.ts` `run workflow implement passes through daemon guard errors without local workflow logic` stays green (non-zero, named stderr, no success JSON).
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — attached workflow wait semantics and completion JSON meaning.
- `v2/docs/operator-runbook.md` — exit zero on attached launch means the workflow finished, not merely the first step.
- `v2/docs/v1-behaviors.md` — update the `jarvis run workflow` attachment bullet to match workflow-terminal wait.

## Prerequisites

- Workflow CLI failure and completion reporting use the workflow entry run's terminal outcome when a workflow spans multiple daemon run rows (daemon rollup on entry `wait`/`list`).
