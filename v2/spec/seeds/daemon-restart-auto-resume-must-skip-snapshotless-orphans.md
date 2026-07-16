# Seed: daemon restart auto-resume must not fail snapshot-less orphans

## Problem

The `daemon-restart-auto-resumes-orphaned-runs` implementation (PR #1625, deferred) auto-resumes
**every** reconciled orphaned run on startup — including rows with no workflow snapshot/stepId
(bare `in-progress`, non-workflow metadata). `reconstructWriteResume` rejects them, and the
recovery code responds by immediately calling `store.setRunStatus(runId, "failed")`.

That silently converts the previously-safe, inspectable `killed` + `unsupported_resume_context`
state (`retryable:false`, `nextAction:"stop"`, documented in `v2/docs/operator-runbook.md`) into
an irreversible `failed` on **every** daemon restart, before the operator can repair the snapshot.
It also breaks the existing integration test
`v2/src/daemon/daemon.sandbox-unrunnable.test.ts:120` (asserts the old contract), which the PR
ticked as passing while it fails deterministically.

## Decisions

- Auto-resume only runs that have a resolvable workflow snapshot/stepId.
- A reconciled orphan with no resumable snapshot **stays** `killed` +
  `unsupported_resume_context` (unchanged pre-existing contract) — not flipped to `failed`.
- Keep the existing integration test green, or rewrite it with an explicit documented rationale.

## Acceptance criteria

- [ ] On restart, a reconciled orphan lacking a workflow snapshot is left `killed` /
      `unsupported_resume_context`, not `failed`.
- [ ] Orphans WITH a snapshot still auto-resume (retain id/worktree/branch, log recovery).
- [ ] `v2/src/daemon/daemon.sandbox-unrunnable.test.ts` (the list-over-IPC contract) stays green.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — restart recovery skips snapshot-less orphans (contract preserved).
