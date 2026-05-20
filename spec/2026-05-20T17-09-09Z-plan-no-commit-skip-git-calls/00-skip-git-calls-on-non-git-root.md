# 00 — Skip remaining git calls on non-git target in `commit: false` plan runs

## Problem

`jarvis plan` against a registered non-git project with `modes.plan.commit: false` crashes during the post-draft phase at `src/commands/plan.ts:1670` and prints leaked `fatal: not a git repository` lines from boundary checks at lines 1676, 1929, and 2019. The completed [`2026-05-20T16-00-24Z-plan-no-commit-allows-non-git`](../completed/2026-05-20T16-00-24Z-plan-no-commit-allows-non-git/index.md) spec removed the early-return guard but missed these call sites.

See [intent.md](./intent.md) for the full traceback and root cause.

## Decisions

- **Gate `baseBranch` behind `if (commit)`.** All consumers are already commit-gated; move the `getCurrentBranch(project.root)` call into the commit-only branches that use it (or wrap line 1670 in `if (commit)`).
- **Make `assertTargetRepoPlanBoundary` a no-op when `project.root` is not a git repo.** Use the same `existsSync(join(projectRoot, ".git"))` check that already gates worktree creation at `src/commands/plan.ts:1060`. Return `{ ok: true }` when there is no `.git`. Do not log anything; the absence of a `.git` directory is not a violation in commit-false mode.
- **Do not change the test that already exists for commit-false non-git plan runs** (`test/plan-command.test.ts:390`). It uses `skipGhCheck` to short-circuit before the agent runs, so it does not exercise this bug. Add a separate test that exercises the post-draft path.

## Task checklist

- [ ] In `src/commands/plan.ts`, gate the `const baseBranch = getCurrentBranch(project.root);` call at line 1670 behind `if (commit)`. Easiest minimal change: declare `let baseBranch: string | null = null;` and assign it inside `if (commit) { baseBranch = getCurrentBranch(project.root); }`. The downstream `if (commit)` blocks already guard access; tighten their types as needed (e.g., `as string` is acceptable inside the gated branches because the flag and the assignment are co-gated).
- [ ] In `src/modes/plan/boundary.ts`, change `assertTargetRepoPlanBoundary` so that when `projectRoot/.git` does not exist (use `existsSync`), it returns `{ ok: true }` without invoking `git`. Keep the existing try/catch around `execFileSync` as a defense in depth; the new `existsSync` guard is the primary fix and avoids the stderr leak entirely.
- [ ] Update the relevant unit tests in `test/plan-boundary.test.ts` (or wherever `assertTargetRepoPlanBoundary` is tested — find with grep) to cover the new "non-git root returns ok" case.
- [ ] Add a new test in `test/plan-command.test.ts` exercising a commit-false plan run on a non-git registered project that **does not** use `skipGhCheck`. Stub the agent (the existing harness has agent stub helpers — follow the pattern used by other `planCommand` tests that exercise the agent path) so the run reaches the post-draft `baseBranch` site. Assert that the command does not throw and that stderr does not contain `fatal: not a git repository`.
- [ ] Run `bun run typecheck` and `bun test` and update acceptance criteria checkboxes only for criteria that the runs actually satisfy.

## Documentation updates

- [ ] No user-facing doc changes are required: `docs/plan-mode.md` already states that `commit: false` works on registered directories regardless of git state. If the doc contains any remaining git-implying language in the commit-false section, remove it; otherwise no edit is needed.

## Acceptance criteria

- [ ] `jarvis plan <intent>` against a registered non-git project with `modes.plan.commit: false` completes the refine and draft phases and at least one review pass without throwing and without printing `fatal: not a git repository` to stderr. Verified by a new test that exercises the post-draft path with a stubbed agent on a non-`git init`'ed project root.
- [ ] `assertTargetRepoPlanBoundary` returns `{ ok: true }` when `<projectRoot>/.git` does not exist, without invoking `git`. Verified by a unit test in `test/plan-boundary.test.ts` (or equivalent).
- [ ] `commit: true` plan runs are unchanged: existing tests in `test/plan-command.test.ts` and `test/plan-boundary.test.ts` continue to pass, and the boundary check still runs `git status` when the target is a git repo.
- [ ] The previously-existing commit-false non-git test (`test/plan-command.test.ts:390`) continues to pass with the same expectations.

## Out of scope

- Changing project resolution to allow ad-hoc non-git directories.
- Reworking `assertTargetRepoPlanBoundary` to detect writes on non-git roots via filesystem snapshots.
- Removing or rewriting the resume guard for `commit: false`.
- Changing any `getCurrentBranch` call on the resume code path (lines 807, 892, 1004, 1025), which is already unreachable for commit-false runs.
