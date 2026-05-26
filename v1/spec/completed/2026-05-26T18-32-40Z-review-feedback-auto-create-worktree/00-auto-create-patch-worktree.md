# 00 - Auto-create patch worktree from existing branch

## Problem

`jarvis1 review-feedback <worktree-name>` fails at v1/src/commands/review-feedback.ts:51 when `.worktree/<name>/` is missing in the target project root, blocking the cross-machine workflow of starting `jarvis1 run` on one machine and addressing PR feedback from another. The branch is on `origin` already (jarvis pushes after every commit), so the worktree can be reconstructed.

## Decisions

- Helper `ensurePatchWorktreeForExistingBranch(projectRoot: string, worktreeName: string): Promise<{ path: string; source: "origin" | "local" }>` lives in `v1/src/worktree.ts` and is exported.
- Helper steps: best-effort `git fetch origin`; check local then origin branch existence; if only remote, create local tracking branch from `origin/<name>`; `mkdirSync(.worktree, { recursive: true })`; `git worktree add --checkout .worktree/<name> <name>`.
- Helper throws plain `Error` with message `no local or remote branch named <name>; cannot create worktree` when neither exists. No custom error class. Rationale: caller does `try/catch` and writes `err.message` to stderr, matching the `assertGhReady` pattern.
- Caller (`reviewFeedbackCommand`) prefixes `jarvis1 review-feedback: ` on stderr and returns exit code 1 for the no-branch error.
- Helper does not handle `currentBranchMatches`; `review-feedback` always targets `.worktree/<name>/`, never the project root.
- Shared internals: `branchExistsLocal`, `branchExistsOnOrigin`, best-effort `git fetch origin` are module-private helpers in `v1/src/worktree.ts` shared by `ensureWorktree` and the new helper. No public API change for existing helpers.
- Reorder in `reviewFeedbackCommand`: plan-prefix guard (`worktreeName.startsWith("plan-")`) runs before the worktree existence check. Existing error text and exit code 1 preserved.
- `loadConfig` is lifted to immediately after the plan-prefix guard and threaded to its existing usage site. Inject via `opts.loadConfigFn ?? loadConfig`; called at most once per invocation.
- `cfg.git === false` and worktree missing: skip auto-create entirely; existing "unknown worktree" path runs.
- Auto-create runs before `acquireWorktreeLock`. Rationale: cannot lock a directory that does not exist.
- Command emits exactly one stdout line via `opts.io.stdout` after the helper returns: `jarvis1 review-feedback: worktree missing; creating .worktree/<name> from origin/<name>` when `source === "origin"`, or `... from local branch <name>` when `source === "local"`. Rationale: helper returns `source` as single source of truth; emitting after avoids a duplicate branch-existence pre-check.
- Helper is io-agnostic; all user-facing output stays in the command.
- No symlink replay (`createWorktreeSymlinks`) on auto-create. Deferred to first consumer: pin when a caller needs build artifacts during review.
- No new CLI flag, no `--create` / `--no-create`, no new config keys, no new exit codes.
- `ReviewCommandOptions` gains optional `ensurePatchWorktreeFn?: (projectRoot: string, name: string) => Promise<{ path: string; source: "origin" | "local" }>` and `loadConfigFn?: () => Config` for test injection.
- `assertGhReady` ordering unchanged; still runs after the (possibly auto-created) worktree exists and after the clean check.
- Cleanup of created worktrees stays user-driven via `jarvis1 cleanup`; no auto-removal.
- Plan worktrees out of scope (rejected by the prefix guard before any fetch or create).
- Commit body must include the line `BEHAVIOR CHANGE: plan-* names with no existing worktree now emit plan-rejection text instead of unknown-worktree text` so reviewers see the text-only change to that path without grepping diffs.
- Deferred to first consumer: `.worktree/<name>/` exists but is checked out to a different branch than `<worktreeName>` — pin when reported. Current path passes through whatever branch is checked out.
- Deferred to first consumer: `git worktree prune` before `git worktree add` if a stale registration exists — pin if `already exists` errors surface in test runs.

## Acceptance criteria

- [x] `ensurePatchWorktreeForExistingBranch(projectRoot, worktreeName)` exists in `v1/src/worktree.ts`, is exported, and returns `Promise<{ path: string; source: "origin" | "local" }>`.
- [x] Helper throws `Error` with message `no local or remote branch named <name>; cannot create worktree` when neither local nor origin branch exists.
- [x] Branch-existence checks and best-effort `git fetch origin` are implemented as module-private helpers in `v1/src/worktree.ts` and called by both `ensureWorktree` and `ensurePatchWorktreeForExistingBranch` (no duplicated implementations).
- [x] In `reviewFeedbackCommand`, the plan-prefix guard runs before the worktree existence check.
- [x] `loadConfig` is invoked at most once per `reviewFeedbackCommand` invocation, immediately after the plan-prefix guard, via `opts.loadConfigFn ?? loadConfig`.
- [x] When `cfg.git === false` and the worktree is missing, `ensurePatchWorktreeFn` is not invoked and the existing "unknown worktree" path runs.
- [x] When the worktree is missing and `cfg.git !== false`, the command emits exactly one stdout line of the form `jarvis1 review-feedback: worktree missing; creating .worktree/<name> from origin/<name>` (or `... from local branch <name>`) before agent invocation.
- [x] `ReviewCommandOptions` exposes optional `ensurePatchWorktreeFn` and `loadConfigFn` for dependency injection.
- [x] Existing "missing worktree exits non-zero" test in `v1/test/review-feedback-command.test.ts` is updated to stub `ensurePatchWorktreeFn` to throw the no-branch error and asserts exit code 1 plus stderr containing `no local or remote branch named missing-one`.
- [x] New test: branch present on a fake `origin` (bare repo) and worktree absent — `.worktree/<name>/` is created with the named branch checked out, the rest of the review-feedback flow runs, and the stdout line contains `from origin/`.
- [x] New test: no branch local or remote — stderr contains `no local or remote branch named <name>` and exit code is 1.
- [x] New test: `cfg.git === false` and worktree missing — a tracking-flag `ensurePatchWorktreeFn` confirms the helper was not called and the existing `unknown worktree` error fires.
- [x] Existing "`plan-*` worktree is rejected in v1" test continues to pass with no changes to its assertions.
- [x] `README.md` `### jarvis1 review-feedback workflow` section states that `review-feedback` auto-materializes `.worktree/<name>/` from `origin/<name>` (or a local branch) when missing, and errors with `no local or remote branch named <name>` otherwise.
- [x] `v1/docs/worktrees-and-commits.md` review-feedback section includes the same one-sentence behavior note.
- [x] `v1/docs/workflows.md` is read during implementation; updated only if it currently documents review-feedback preconditions, otherwise left unchanged.
- [x] `bun run typecheck` is green.
- [x] `bun test` is green.
