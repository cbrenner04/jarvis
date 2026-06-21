# 01 — Reproduce cited failures on the base ref

## Problem

Subspec `00` rejects a base-ref-failure blocker claim only when an injected seam
reports the base ref green; with no seam it fail-safes to exit 7. This subspec
provides the production seam: actually run the target repo's test command at the
base ref and return green/red, so validation works outside tests.

## Decisions

- Base ref = the local **merge-base** of the agent branch and its base branch (`git merge-base <baseBranch> HEAD`, as `prompt.ts:250` already does), resolved to a commit SHA. Offline (no `gh`), so `skipGhCheck`/network-down runs still validate instead of degrading to fail-safe, and it is precisely the commit the branch forked from rather than the base branch's current tip. Rules out: `getBaseBranch` (`gh.ts:78`) — it shells to `gh` (network; degrades to fail-safe offline) and names the default branch as-it-is-now, which can differ from the branch's actual fork point.
- Test command = the target repo's `bun run test`, matching the existing patch runner (`v1/src/modes/patch/shrink.ts:252`). Rules out: a bespoke command that could diverge from what shrink/completion run.
- Run in a throwaway git worktree created **detached at the resolved base commit** (`git worktree add --detach <dir> <sha>`), never on the base branch. Detached because the base branch is normally already checked out in the primary worktree, and `git worktree add <branch>` refuses a branch already checked out — breaking the happy path. Never reset or `git clean` the agent's working dir. Rules out: branch checkout (fails when base branch is checked out elsewhere); checking out base in the agent worktree (destroys in-progress edits).
- Worktree cleanup (`git worktree remove --force`) is **guaranteed on every exit path**, including when the test run throws (finally-style). Rules out: leaking a worktree when the test command errors — the AC promises no leftover worktree.
- Green = test command exits 0; any non-zero (including infra/setup failure) is treated as non-green, so `00` fail-safes the blocker to stand. Rules out: rejecting a real blocker because the base-ref harness itself errored.

## Task checklist

- [x] Implement the base-ref test runner: resolve the base commit via local `git merge-base`, create a throwaway worktree detached at that commit, run `bun run test`, return pass/fail, remove the worktree in a finally.
- [x] Wire it as the default async base-ref-run used by `00` when no test seam is injected.
- [x] Add tests covering green base (blocker rejected end-to-end), red base (blocker stands), and worktree cleanup after the test run throws.

## Acceptance criteria

- [x] In a git checkout whose base ref is green, a patch-mode blocker citing pre-existing failures is rejected without any injected seam: the run continues past exit 7 and the `## Blocker` section is removed.
- [x] Validation works with the base branch already checked out in the primary worktree (detached-commit worktree, not a branch checkout) and without invoking `gh` (local merge-base, so it functions under `skipGhCheck`/offline).
- [x] In a checkout whose base ref genuinely fails the test command, the same blocker stands and the run exits 7.
- [x] The base-ref test run executes in a throwaway worktree; the agent's working directory and branch are unchanged afterward (no reset, no clean), and the worktree is removed even when the test run throws (no leftover worktree).
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [x] `v2/docs/v1-behaviors.md` — record that base-ref blocker validation runs the target `bun run test` in a throwaway worktree detached at the local merge-base of the agent branch and its base (offline; no `gh`), leaving the agent worktree untouched, removing the worktree on every exit path, and treating any non-zero exit as non-green (fail-safe).
