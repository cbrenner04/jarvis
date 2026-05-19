# `jarvis review` — single-pass PR review comment handling

repo: git@github.com:cbrenner04/jarvis.git

Jarvis can create and update implementation PRs, but once a reviewer leaves
comments the handoff back into the harness is manual: pull the worktree, read
GitHub comments, restate them to an agent, then commit and push the result. The
review cycle belongs in the harness so the same safety rails, agent fallback
order, and worktree conventions used by `jarvis run` also apply after review.

This spec adds a v1 `jarvis review` command for normal patch worktrees. The
command inspects one existing `.worktree/<name>/` checkout, gathers actionable
open PR review feedback, asks the configured patch-mode agents to address it in
a single pass, and then commits and pushes the resulting changes. It does not
attempt to mutate GitHub review state beyond updating the branch.

## Decisions

- **v1 stays in the current harness.** This is a new CLI command in the v1
  codebase, not a v2 rewrite prerequisite. It should reuse existing helpers
  where they already exist (`runSharedPreflight`, `assertGhReady`,
  `checkPrExists`, `pushCurrent`, patch-mode agent order) rather than adding a
  parallel lifecycle.
- **Patch worktrees only in v1.** The supported entrypoint is
  `jarvis review <worktree-name>`, where `<worktree-name>` resolves to
  `<projectRoot>/.worktree/<worktree-name>`. Plan worktrees (`plan-*` /
  `plan/<name>`) and arbitrary directories outside `.worktree/` are out of
  scope for this first cut.
- **Clean-start safety gate.** If the target worktree is already dirty before
  comment fetching or agent execution, the command exits non-zero and tells the
  user to inspect or clean the tree first. This prevents the fixed harness
  commit message from absorbing unrelated local edits.
- **Only actionable open feedback goes to the agent.** Inline review feedback
  is sourced from unresolved review threads. Top-level PR comments are narrowed
  to recent, non-bot comments so the agent is not re-sent the entire PR history
  on every run.
- **One review pass, one harness-authored commit.** The harness runs the same
  patch-mode fallback agent order once, commits only if the agent exits cleanly
  and the worktree changed, and then pushes via the existing upstream-aware
  helper. The command does not auto-resolve threads, post replies, or loop
  until comments disappear.

## Subspecs

- [ ] [00 - CLI entry and worktree safety gates](./00-cli-entry-and-worktree-safety-gates.md)
- [ ] [01 - Collect actionable PR review feedback and render the prompt](./01-collect-actionable-pr-review-feedback-and-render-the-prompt.md)
- [ ] [02 - Run the agent, commit, push, and document the workflow](./02-run-the-agent-commit-push-and-document-the-workflow.md)
