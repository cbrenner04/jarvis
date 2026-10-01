---
name: completion-commit-run-scope
---

# Harness completion commits stay within the run scope

## Problem

`createCompletionCommitter` stages `git add -A` minus harness sidecars, so shrink, write checkpoint/completion, resume recovery, and ready-gate repair re-commits can sweep files the run never touched or resurrect stale `main` blobs.

## Decisions

- After staging, every harness commit path enforces the same allowset: paths in the run diff against merge base, the spec tree, or a test co-located with a path in that diff; the allowset comes from durable run state (persisted frozen repair fence when present, otherwise the same derivation ready-gate repair uses), not ad hoc worktree drift.
- Out-of-scope staged paths revert to `HEAD`, are named in a `commit_scope_violation` log event, and the commit proceeds on the in-scope remainder; an empty remainder is no-progress, not success.
- A staged in-scope path whose new blob matches an older `main` commit while current `main` differs is refused like out-of-scope (stale-main sweep).

## Acceptance criteria

- [ ] `completion-commit.test.ts`: a worktree with an in-scope edit plus a file the run never touched commits only the in-scope path, reverts the other, and emits `commit_scope_violation` naming it; fails against the pre-fix `add -A` staging.
- [ ] `completion-commit.test.ts`: a staged path whose content matches an older `main` blob while current `main` differs is refused even when the path is in the run diff; fails against the pre-fix committer.
- [ ] One fake-git test per harness commit entrypoint proves shrink, resume-recovery, and write completion each invoke the scope check (`write-loop.test.ts`, `workflow-runner-resume*.test.ts`, or `completion-commit.test.ts` as appropriate).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — commit scope check and stale-main regression refusal on every harness commit path.
- `v2/docs/operator-practices.md` — diff each lane against its merge base before merge remains required until this lands.

## Prerequisites
