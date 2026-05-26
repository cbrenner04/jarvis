# 00 - Auto-create patch worktree from existing branch

## Problem

`jarvis1 review-feedback <worktree-name>` fails at v1/src/commands/review-feedback.ts:51 when `.worktree/<name>/` is missing in the target project root, blocking the cross-machine workflow of starting `jarvis1 run` on one machine and addressing PR feedback from another. The branch is on `origin` already (jarvis pushes after every commit), so the worktree can be reconstructed.

## Decisions

- Helper `ensurePatchWorktreeForExistingBranch(projectRoot: string, worktreeName: string): Promise<{ path: string; source: "origin" | "local" }>` lives in `v1/src/worktree.ts` and is exported.
- Helper: best-effort `git fetch origin`, check local then origin branch existence, create local tracking branch from `origin/<name>` if only remote, then `mkdirSync(.worktree, { recursive: true })` and `git worktree add --checkout .worktree/<name> <name>`.
- Helper throws plain `Error` with message `no local or remote branch named <name>; cannot create worktree` when neither exists. Caller prefixes `jarvis1 review-feedback: ` to stderr and returns exit code 1.
- Helper does not handle the `currentBranchMatches` shortcut from `ensureWorktree`; `review-feedback` always uses `.worktree/<name>/`.
- Shared internals refactor: `branchExistsLocal`, `branchExistsOnOrigin`, and best-effort `git fetch origin` extracted to module-private helpers shared by `ensureWorktree` and the new helper. No public API change.
- Reorder in `reviewFeedbackCommand`: plan-prefix guard (`worktreeName.startsWith("plan-")`) moves above the existence/auto-create branch. Existing error text and exit code 1 preserved.
- `loadConfig` lifted to immediately after plan-prefix guard, before the existence check. Inject once via `opts.loadConfigFn ?? loadConfig`; thread to existing usage site (currently line 139). Do not re-load.
- `cfg.git === false`: skip auto-create entirely; existing "unknown worktree" path runs. No new error text.
- Auto-create runs before `acquireWorktreeLock`. Rationale: cannot lock a directory that does not exist.
- Command emits stdout line **before** invoking the helper-driven git operations. Helper returns `source` so command picks wording: `jarvis1 review-feedback: worktree missing; creating .worktree/<name> from origin/<name>` or `... from local branch <name>`.
- Stdout routed through `opts.io.stdout` from `reviewFeedbackCommand`; helper is io-agnostic.
- No symlink replay (`createWorktreeSymlinks`) on auto-create. Deferred to first consumer: pin when a caller needs build artifacts during review.
- No new CLI flag, no `--create` / `--no-create` opt-out, no new config keys, no new exit codes.
- `ReviewCommandOptions` gains optional `ensurePatchWorktreeFn?: (projectRoot: string, name: string) => Promise<{ path: string; source: "origin" | "local" }>` and `loadConfigFn?: () => Config` for test injection.
- Existing `gh` readiness check (`assertGhReady`) ordering unchanged; runs after auto-create and after clean check.
- Cleanup of created worktrees stays user-driven via `jarvis1 cleanup`; no auto-removal.
- Plan worktrees out of scope (already rejected by the prefix guard).
- Deferred to first consumer: `.worktree/<name>/` exists but checked out to a different branch — pin when reported. Current path passes through whatever branch is checked out.
- Deferred to first consumer: `git worktree prune` before `git worktree add` if a stale registration exists — pin if `already exists` errors surface in test runs.

## Behavior change to call out

Plan-prefixed names (`plan-*`) invoked against a missing worktree previously emitted `unknown worktree`; after the guard reorder they emit the plan-rejection message instead. Same exit code 1; only text changes. Include `BEHAVIOR CHANGE: plan-* names with no existing worktree now emit plan-rejection text instead of unknown-worktree text` in the commit body.

## Tasks

- Extract `branchExistsLocal`, `branchExistsOnOrigin`, best-effort `git fetch origin` as module-private helpers in `v1/src/worktree.ts` shared with `ensureWorktree`.
- Add and export `ensurePatchWorktreeForExistingBranch` in `v1/src/worktree.ts`.
- Reorder `reviewFeedbackCommand`: plan-prefix guard first; then `loadConfig` lift; then existence check; if missing and `cfg.git !== false`, invoke helper, emit stdout line; else preserve existing "unknown worktree" behavior.
- Add `ensurePatchWorktreeFn` and `loadConfigFn` injection points to `ReviewCommandOptions`.
- Update existing test `v1/test/review-feedback-command.test.ts:98` ("missing worktree exits non-zero"): stub `ensurePatchWorktreeFn` to throw the no-branch error; assert exit code 1 and stderr contains `no local or remote branch named missing-one`. Pick the stub approach (not real `loadConfigFn`) and document inline.
- Existing plan-prefix test (line 110) pre-creates the worktree; leave its setup intact — assertions remain valid post-reorder.
- New test: branch on origin, no local worktree — scaffold via bare repo as `origin`, `git remote add origin <bare>`, push named branch to origin; assert worktree created and rest of flow runs; assert stdout line contains `from origin/<name>`.
- New test: no branch local or remote — assert stderr contains `no local or remote branch named <name>` and exit code 1.
- New test: `cfg.git === false` and worktree missing — inject `loadConfigFn` returning `{ ..., git: false }` and a tracking-flag `ensurePatchWorktreeFn`; assert tracking flag stayed false and existing `unknown worktree` error fires.
- Update `README.md` `### jarvis1 review-feedback workflow` section: one sentence stating `review-feedback` auto-materializes `.worktree/<name>/` from `origin/<name>` (or a local branch) when missing, and errors with `no local or remote branch named <name>` otherwise.
- Update `v1/docs/worktrees-and-commits.md` review-feedback section with the same one-sentence behavior note.
- Read `v1/docs/workflows.md` during implementation; only update if it currently mentions review-feedback preconditions. Otherwise no addition.

## Acceptance criteria

- [ ] `ensurePatchWorktreeForExistingBranch(projectRoot, worktreeName)` exists in `v1/src/worktree.ts`, is exported, and returns `Promise<{ path: string; source: "origin" | "local" }>`.
- [ ] Helper throws `Error` with message `no local or remote branch named <name>; cannot create worktree` when neither local nor origin branch exists.
- [ ] Shared module-private helpers for branch-existence checks and `git fetch origin` are used by both `ensureWorktree` and `ensurePatchWorktreeForExistingBranch` (no duplicated implementations).
- [ ] In `reviewFeedbackCommand`, the plan-prefix guard runs before the worktree existence check.
- [ ] `loadConfig` is invoked at most once per `reviewFeedbackCommand` invocation, immediately after the plan-prefix guard, via `opts.loadConfigFn ?? loadConfig`.
- [ ] When `cfg.git === false` and the worktree is missing, the auto-create helper is not invoked and the existing "unknown worktree" path runs.
- [ ] When the worktree is missing and `cfg.git !== false`, the command emits exactly one stdout line of the form `jarvis1 review-feedback: worktree missing; creating .worktree/<name> from origin/<name>` (or `... from local branch <name>`) before agent invocation.
- [ ] `ReviewCommandOptions` exposes optional `ensurePatchWorktreeFn` and `loadConfigFn` for dependency injection.
- [ ] Updated existing test at `v1/test/review-feedback-command.test.ts` ("missing worktree exits non-zero") stubs `ensurePatchWorktreeFn` to throw the no-branch error and asserts exit code 1 plus stderr containing `no local or remote branch named missing-one`.
- [ ] New test: branch present on a fake `origin` (bare repo), worktree absent — `.worktree/<name>/` is created, the named branch is checked out, the rest of the review-feedback flow runs, and stdout line contains `from origin/`.
- [ ] New test: no branch anywhere — stderr contains `no local or remote branch named <name>`, exit code is 1.
- [ ] New test: `cfg.git === false` and worktree missing — injected tracking flag confirms `ensurePatchWorktreeFn` was not called; existing `unknown worktree` error fires.
- [ ] Existing plan-prefix test (`plan-*` worktree is rejected in v1) continues to pass with no changes to its assertions.
- [ ] `README.md` `### jarvis1 review-feedback workflow` section mentions auto-materialization of `.worktree/<name>/` from `origin/<name>` (or a local branch) when missing, and the `no local or remote branch named <name>` error otherwise.
- [ ] `v1/docs/worktrees-and-commits.md` review-feedback section includes the same one-sentence behavior note.
- [ ] `bun run typecheck` is green.
- [ ] `bun test` is green.
