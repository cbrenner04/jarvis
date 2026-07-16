# Retire merged v2 workspaces

## Problem

`jarvis cleanup` does not discover v2 worktrees under `~/.jarvis/worktrees/`, so merged workspaces and local branches accumulate unless the operator removes them manually.

## Decisions

- Discover worktrees from v2's external home and resolve their registered project roots; rules out limiting cleanup to v1's repo-local `.worktree/` layout.
- Require a merged PR and no open or daemon-live run for the workspace at removal time; rules out age-based retirement and preview-to-confirm ownership races.
- Fail closed when PR or live-ownership inspection is unavailable; rules out treating an inspection outage as retirement permission.
- Remove only the worktree and local branch; rules out remote-branch deletion, spec archival, ready-intent pruning, and durable run-row deletion.
- Keep `jarvis cleanup`, `--dry-run`, and `[y/N]`; rules out a v2-only command or implicit destructive execution.

## Work

- Add merged-workspace discovery and retirement for registered projects under `~/.jarvis/worktrees/<project>/`, including nested branch paths.
- Exclude any workspace referenced by a non-terminal durable run or a daemon-reported live run, and recheck ownership before removal.
- Inspect PR state, preview each worktree path and local branch, support mutation-free `--dry-run`, prompt before mutation, and report removal failures without deleting run history.
- Route the top-level CLI command and cover command parsing, cancellation, safety guards, and successful retirement.
- Align the command reference, operator runbook, and first-workflow close-out.

## Acceptance criteria

- [x] `jarvis cleanup --dry-run` discovers merged-PR worktrees beneath each registered project's `~/.jarvis/worktrees/<project>/` home, including slash-nested branch paths, and previews both worktree and local-branch removals without prompting or mutating state.
- [x] `jarvis cleanup` prompts `[y/N]`; declining changes nothing, while confirmation removes each still-eligible worktree registration/directory and its local branch without deleting the remote branch, specs, ready intents, or durable run rows.
- [x] A worktree is omitted when its PR is not merged, PR or ownership inspection cannot establish eligibility, a non-terminal durable run references it, or the daemon reports a referencing run live; ownership is rechecked after confirmation before removal.
- [x] Cleanup handles registered projects independently, leaves an ineligible or failed candidate intact, and exits nonzero when a confirmed retirement fails.
- [x] `v2/src/commands/cleanup.test.ts` and `v2/src/cli.test.ts` add regression coverage for discovery, dry-run, confirmation, merged-state filtering, durable/live ownership guards, failure isolation, retained run rows, and local-only branch deletion that fails against the pre-change code and passes after implementation.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/first-workflow-walkthrough.md` document the cleanup command, preview/confirmation flow, safety guards, retained artifacts/history, and session-end invocation.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the `jarvis cleanup [--dry-run]` CLI contract.
- Update `v2/docs/operator-runbook.md` with merged-workspace cleanup and safety guards.
- Update `v2/docs/first-workflow-walkthrough.md` with session-end cleanup.
