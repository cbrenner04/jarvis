# 02 - Run the agent, commit, push, and document the workflow

## Problem

Once actionable review feedback is available, the harness still needs to apply
the same execution discipline used elsewhere: ordered agent fallback, clear
failure handling, harness-authored commits, and upstream-safe pushes. This is
the slice that turns review mode from a read-only inspector into a usable daily
workflow.

## Decisions

- Reuse `cfg.modes.patch.agentOrder` and the existing `createAgent` /
  patch-style fallback loop rather than inventing a separate review-agent
  configuration surface.
- Run exactly one logical review pass per invocation:
  - try agents in configured order until one succeeds or all fail/quota out
  - do not loop on the same comments after a successful pass
- The agent runs in the target worktree and is told not to create commits.
  Jarvis remains the sole committer.
- After a successful agent run, only continue if the worktree changed relative
  to the clean-start baseline. A clean worktree after the run is a failure:
  print a warning that the agent made no changes and exit non-zero without
  committing.
- Reuse the same upstream-detection behavior patch mode uses before calling
  `pushCurrent`.
  - If the current helper is private to patch mode, extract a shared helper
    rather than duplicating branch-tracking checks inside review mode.
- Commit all resulting changes with a fixed harness-authored message:
  `address PR review comments`
  Appending `(PR #<number>)` is optional but the spec does not require it.
- Push through `pushCurrent({ cwd, firstPush })` so upstream creation behavior
  matches the rest of the harness. The command must treat push failures as
  command failures.
- Exit non-zero, with no commit, on:
  - agent failure after exhausting the configured fallback order
  - quota exhaustion across the configured fallback order
  - clean worktree after agent completion
  - commit failure
  - push failure
- If commit succeeds but push fails, report the failure and stop. Do not try to
  rewrite or roll back the local commit.
- Leave thread resolution, comment replies, PR body edits, and any GitHub-side
  acknowledgement out of scope for v1.

## Task Checklist

- [ ] Add the review-mode agent execution loop using patch-mode agent order and
  existing agent creation infrastructure.
- [ ] Track before/after worktree state so review mode can distinguish a
  successful edit from a no-op run.
- [ ] Stage and commit changed files with the fixed review commit message.
- [ ] Push the commit with `pushCurrent`, handling first-push cases through the
  same upstream-detection rule patch mode already uses.
- [ ] Add tests covering: successful run with commit/push, agent no-op failure,
  ordered fallback across agents, agent failure without commit, and push
  failure after a created commit.
- [ ] Update user-facing docs for the full review workflow and its current
  non-goals.

## Acceptance criteria

- [ ] `jarvis review <worktree-name>` uses `modes.patch.agentOrder` for review
  execution and preserves ordered fallback semantics.
- [ ] When an agent succeeds and changes files, Jarvis creates exactly one
  harness-authored commit with the fixed review message and pushes it.
- [ ] When no file changes exist after the agent run, the command exits
  non-zero, prints a no-op warning, and does not create a commit.
- [ ] When all configured agents fail or exhaust quota, the command exits
  non-zero and does not create a commit.
- [ ] Push failures surface as non-zero command failures rather than being
  silently ignored; a failed push after commit creation is reported without
  attempting rollback.
- [ ] The command does not resolve review threads, post PR replies, or modify
  PR metadata in v1.
- [ ] `bun run typecheck` and `bun test` pass after this slice lands.

## Documentation updates

- `README.md`: expand the command description or examples section to show the
  basic `jarvis review <worktree-name>` workflow.
- `docs/workflows.md`: document the full review loop, including the clean-start
  requirement, GitHub comment sourcing, single-pass agent behavior, and the
  fact that v1 does not auto-resolve threads or post replies.
