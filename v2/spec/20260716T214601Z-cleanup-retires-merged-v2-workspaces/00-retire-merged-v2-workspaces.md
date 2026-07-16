# Retire merged v2 workspaces

## Problem

`jarvis cleanup` does not discover v2 worktrees under `~/.jarvis/worktrees/`, so merged workspaces and local branches accumulate unless the operator removes them manually.

Two prior implementations were rejected on review, both with every acceptance criterion ticked and a green gate (PRs #1672, #1675). Both resolved `~/.jarvis` internally and spawned `gh`/`git` ambiently, leaving no seam; the only way to green the suite was to mock around the unit under test. One shipped a permanent no-op behind a `gh pr view --head` invalid flag, hidden by a stub matching the command name; the other shipped `rmSync` with no `git worktree remove`, orphaning the branch. The seam decisions below are what changed.

## Decisions

- Discover worktrees from v2's external home and resolve their registered project roots; rules out limiting cleanup to v1's repo-local `.worktree/` layout.
- Take the worktrees home as an injectable `jarvisRoot`, defaulting to `jarvisHome()` exactly as `getExternalWorktreePath` does (`v2/src/execution/external-worktree.ts:47`); rules out resolving `~/.jarvis` internally, which leaves no seam and forces tests to mock around the unit under test.
- Take the subprocess seam as an injectable `AsyncSubprocessRunner` (`shared/subprocess.ts`), defaulting to `realAsyncSubprocessRunner`; rules out an ambient spawn that only a command-name-matching stub can intercept.
- Retire a worktree via `git worktree remove` plus `git worktree prune` before deleting the local branch; rules out `rmSync` of the directory, which leaves the `.git/worktrees/` registration behind and makes the subsequent branch delete fail.
- Require a merged PR and no open or daemon-live run for the workspace at removal time; rules out age-based retirement and preview-to-confirm ownership races.
- Fail closed when PR or live-ownership inspection is unavailable — an unreachable daemon or a failing `gh` call yields *ineligible*, never an empty result set read as permission; rules out treating an inspection outage as retirement permission.
- Remove only the worktree and local branch; rules out remote-branch deletion, spec archival, ready-intent pruning, and durable run-row deletion.
- Keep `jarvis cleanup`, `--dry-run`, and `[y/N]`; rules out a v2-only command or implicit destructive execution.

## Work

- Add merged-workspace discovery and retirement for registered projects under `~/.jarvis/worktrees/<project>/`, including nested branch paths.
- Exclude any workspace referenced by a non-terminal durable run or a daemon-reported live run, and recheck ownership before removal.
- Inspect PR state, preview each worktree path and local branch, support mutation-free `--dry-run`, prompt before mutation, and report removal failures without deleting run history.
- Route the top-level CLI command and cover command parsing, cancellation, safety guards, and successful retirement.
- Align the command reference, operator runbook, and first-workflow close-out.

## Acceptance criteria

- [ ] `jarvis cleanup --dry-run` discovers merged-PR worktrees beneath each registered project's `~/.jarvis/worktrees/<project>/` home, including slash-nested branch paths, and previews both worktree and local-branch removals without prompting or mutating state.
- [ ] `jarvis cleanup` prompts `[y/N]`; declining changes nothing, while confirmation removes each still-eligible worktree registration/directory and its local branch without deleting the remote branch, specs, ready intents, or durable run rows.
- [ ] A worktree is omitted when its PR is not merged, PR or ownership inspection cannot establish eligibility, a non-terminal durable run references it, or the daemon reports a referencing run live; ownership is rechecked after confirmation before removal.
- [ ] Cleanup handles registered projects independently, leaves an ineligible or failed candidate intact, and exits nonzero when a confirmed retirement fails.
- [ ] Retirement leaves no stale `.git/worktrees/` registration: after a confirmed removal, `git worktree list` no longer names the path and the local branch delete succeeds. Re-running cleanup over the same already-retired workspace is a no-op, not a failure.
- [ ] `v2/src/commands/cleanup.test.ts` and `v2/src/cli.test.ts` drive discovery against a temp `jarvisRoot` holding real materialized worktrees — never a registry whose root does not exist — and every test asserts a non-empty candidate set before asserting the behavior under test, so a zero-candidate early return cannot satisfy it.
- [ ] Every `gh` and `git` expectation asserts the full argv the injected runner received, not the executable name. A stub answering `gh pr view --head <branch>` — an invalid flag for `gh pr view` — fails the suite.
- [ ] Each safety guard is individually load-bearing: removing the merged-PR check, the non-terminal-durable-run check, the daemon-live check, or the post-confirmation ownership recheck each turns at least one test red.
- [ ] `bun run check`, `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/first-workflow-walkthrough.md` document the cleanup command, preview/confirmation flow, safety guards, retained artifacts/history, and session-end invocation.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the `jarvis cleanup [--dry-run]` CLI contract.
- Update `v2/docs/operator-runbook.md` with merged-workspace cleanup and safety guards.
- Update `v2/docs/first-workflow-walkthrough.md` with session-end cleanup.
