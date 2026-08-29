---
name: resume-iteration-commit-failures
---

# Daemon resume recovers failed iteration commits

## Prerequisites

- An `iteration_commit_failed` terminal record carries a bounded boundary-commit error message and available Git stderr while preserving the authored uncommitted work.

## Problem

- The write loop advertises `iteration_commit_failed` as resumable, but daemon reconstruction can replace that contract with `unsupported_resume_context`, `retryable: false`, and `nextAction: stop` for a standalone implement row.
- Operator-error projection omits the terminal boundary-commit cause.

## Behavior

- A failed standalone implement row with a valid persisted write snapshot is admitted through ordinary `jarvis run resume`, reusing its run, worktree, and uncommitted authored changes.
- `jarvis run list` and `wait` project the boundary-commit cause and agree with resume admission: `reason: iteration_commit_failed`, `retryable: true`, `nextAction: resume`, and `resumable: true`.

## Decisions

- Recover through snapshot-backed write-loop resume; rules out a separate commit-only recovery protocol for the first supported caller.
- Reuse the existing run and worktree without reset or clean; rules out fresh dispatch that can strand or overwrite authored changes.
- Keep invalid or missing write snapshots unsupported; rules out broad admission without executable recovery context.

## Acceptance criteria

- [ ] A `daemon-resume.test.ts` fixture seeds the observed failed standalone implement row with a valid snapshot and dirty authored file, then asserts resume admission and same-worktree execution; it fails against the current `unsupported_resume_context` projection.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resumes a failed standalone implement boundary commit from its persisted write snapshot`; Mutation checkpoint: its test body carries `// @mutate v2/src/daemon/daemon.ts "if (!isResumeAdmitted(run, terminalRecord)) return undefined;" -> "if (true) return undefined;"`, restoring `unsupported_resume_context` and turning the scoped test red.
- [ ] `run-operator-error.test.ts` asserts the terminal boundary-commit cause projects on the retryable `iteration_commit_failed` operator error.
- [ ] List, wait, and resume expose one consistent resumability contract for the seeded row.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — include `iteration_commit_failed` in snapshot-backed resume admission and operator-error cause projection.
- `v2/docs/operator-runbook.md` — name the boundary-commit cause and ordinary resume recovery without deleting the worktree.
- `v2/docs/v1-behaviors.md` — record the corrected existing daemon resume behavior.
