---
name: idle-timeout-resume-admission
---

# Admit resume for committed-progress idle timeouts

## Problem

Daemon operator-error projection and resume admission map every failed `idle_output_timeout` to `nextAction: "stop"`, so a write-loop settlement that proves committed progress would still remain stranded.

## Decisions

- A failed `idle_output_timeout` with matching terminal `loop_finished.resumable: true` projects `retryable: true`, `nextAction: "resume"`, and admits `jarvis run resume` on the retained workspace — rules out advertising recovery the daemon refuses.
- A failed `idle_output_timeout` with `resumable: false`, missing terminal proof, or attempt detail alone remains `retryable: false` with `nextAction: "stop"` — rules out inferring checkpoint progress from the outcome kind.
- Resume continues the persisted write step from its existing branch and worktree — rules out fresh dispatch or stale-workspace reset that discards the checkpoint.

## Prerequisites

- A write-loop `idle_output_timeout` whose boundary checkpoint produced a fresh `iteration_commit` records terminal `loop_finished.resumable: true`; a skipped or absent checkpoint records `false`.
- Daemon list, wait, and resume admission derive terminal recovery from durable run state plus the terminal log record.

## Acceptance criteria

- [ ] `run-operator-error.test.ts` asserts committed-progress `idle_output_timeout` terminal evidence maps to `reason: "idle_output_timeout"`, `retryable: true`, and `nextAction: "resume"`; it fails against the baseline unconditional stop mapping.
- [ ] The committed-progress operator-error test carries an in-body `// @mutate` directive that replaces the production resumable idle-timeout guard with `false`; applying it turns the test RED.
- [ ] `daemon-wait-run-completion.test.ts` asserts `run list` and `run wait` project a committed-progress idle timeout as `resumable: true` with `nextAction: "resume"`, while no-committed-progress and attempt-only cases remain `resumable: false` with `nextAction: "stop"`.
- [ ] `daemon-resume.test.ts` admits `jarvis run resume` for the committed-progress case, re-enters the persisted write step on the retained branch and worktree without stale reset, and refuses the no-progress case; the admitted case fails against the baseline terminal-run refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — conditional `idle_output_timeout` retryability, `nextAction`, and resume admission.
- `v2/docs/operator-runbook.md` — use `jarvis run resume` after a committed-progress idle timeout; retain stop/re-dispatch guidance when no checkpoint commit exists.
- `v2/docs/v1-behaviors.md` — record daemon projection and retained-workspace resume semantics.
