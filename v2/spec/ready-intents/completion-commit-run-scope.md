---
name: completion-commit-run-scope
---

# Harness completion commits stay within the run scope

## Problem

`createCompletionCommitter` stages `git add -A` minus harness sidecars, so shrink, write checkpoint/completion, resume recovery, and ready-gate repair re-commits can sweep files the run never touched or resurrect stale `main` blobs.

## Decisions

- Scope lives in `createCompletionCommitter`; shrink, write checkpoint/completion, resume recovery, and ready-gate repair re-commits all call it. After staging, enforce one allowset: paths in the run diff against merge base, the spec tree, or a test co-located with a path in that diff; load persisted frozen repair fence paths when present, else derive with `initializeFrozenRepairAllowset` (same helper ready-gate repair uses), not ad hoc worktree drift.
- Out-of-scope staged paths revert to `HEAD`, are named in a `commit_scope_violation` log event, and the commit proceeds on the in-scope remainder; an empty remainder is no-progress, not success.
- Stale-main refusal (no history walk): refuse when staged content equals the path blob at lane `baseRef` and differs from the integration main-tip blob for that path; treat like out-of-scope (revert + `commit_scope_violation`).

## Acceptance criteria

- [ ] `completion-commit.test.ts`: a worktree with an in-scope edit plus a file the run never touched commits only the in-scope path, reverts the other, and emits `commit_scope_violation` naming it; fails against the pre-fix `add -A` staging.
- [ ] `completion-commit.test.ts`: a staged path whose content matches an older `main` blob while current `main` differs is refused even when the path is in the run diff; fails against the pre-fix committer.
- [ ] One fake-git test per harness commit entrypoint proves shrink, resume-recovery, write completion, and ready-gate repair re-commit each invoke the scope check (`write-loop.test.ts`, `workflow-runner-resume*.test.ts`, or `completion-commit.test.ts` as appropriate); fails against the pre-fix committer that skips the check.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — commit scope check and stale-main regression refusal on every harness commit path.
- `v2/docs/operator-practices.md` — after land, harness commits enforce run scope automatically; pre-merge lane diff against merge base remains a sanity check, not the primary guard.
- `v2/docs/v1-behaviors.md` — catalog harness commit scope enforcement and stale-main refusal.

## Prerequisites
