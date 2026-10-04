# Shrink prompt diffs against merge base

## Problem

`shrinkPromptPlaceholders` builds `ALLOWLIST`, `BRANCH_DIFF`, and `RUN_SCOPED_DIFF` with two-dot diffs against `step.worktree.baseRef`, so paths changed only on `main` after the fork appear in shrink scope and invite agents to "restore" them (reachable via `shrinkPromptPlaceholders` in `workflow-runner.ts` and commit `d39f5071c`).

## Decision ledger

- Resolve diff anchor with `resolveLaneMergeBase(worktreePath, step.worktree.baseRef, runner)`; when defined, use it for `changedFiles`, `BRANCH_DIFF`, and `RUN_SCOPED_DIFF`; when undefined, keep today's `baseRef` behavior; rules out failing shrink when merge-base is missing.
- Export `shrinkPromptPlaceholders` for real-git tests only if the test file cannot reach behavior otherwise; rules out duplicating placeholder assembly in the test.
- Depends on [00-main-sync-scope-module.md](./00-main-sync-scope-module.md); do not reimplement merge-base resolution in `workflow-runner.ts`.

## Task checklist

- Update `shrinkPromptPlaceholders` (and `changedFiles` call sites it uses for allowlist) to diff against merge base when available.
- Add `v2/src/execution/workflow-runner-shrink-placeholders.test.ts` with a real-git fixture: path changed only on `main` after fork is absent from `ALLOWLIST`, `BRANCH_DIFF`, and `RUN_SCOPED_DIFF`.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-shrink-placeholders.test.ts` (real git, exported `shrinkPromptPlaceholders`): a path changed only on `main` after the fork is absent from ALLOWLIST, BRANCH_DIFF, and RUN_SCOPED_DIFF; fails pre-fix.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes for `v2/src/execution/workflow-runner-shrink-placeholders.test.ts`.

## Documentation updates

- `v2/docs/write-behavior.md` — shrink placeholder diffs use lane merge base when resolved, else `baseRef`.
- `v2/docs/v1-behaviors.md` — **[v2 behavior change]** catalog shrink diff base vs v1/baseRef-only behavior.
