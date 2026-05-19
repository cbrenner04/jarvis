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
  where they already exist (`assertGhReady`, `checkPrExists`, `pushCurrent`,
  patch-mode agent order) rather than adding a parallel lifecycle.
  - Because current shared preflight is spec-path-centric, this work may first
    extract a smaller project/log preflight helper instead of pretending review
    mode can call the existing entrypoint unchanged.
- **Patch worktrees only in v1.** The supported entrypoint is
  `jarvis review <worktree-name>`, where `<worktree-name>` resolves to
  `<projectRoot>/.worktree/<worktree-name>`. Plan worktrees (`plan-*` /
  `plan/<name>`) and arbitrary directories outside `.worktree/` are out of
  scope for this first cut.
- **Normal worktree safety still applies.** Review mode must acquire the same
  worktree lock and fail on the same pre-existing dirty-state conditions as
  other mutating Jarvis commands.
- **Clean-start safety gate.** If the target worktree is already dirty before
  comment fetching or agent execution, the command exits non-zero and tells the
  user to inspect or clean the tree first. This prevents the fixed harness
  commit message from absorbing unrelated local edits.
- **Only actionable open feedback goes to the agent.** Inline review feedback
  is sourced from unresolved review threads. Top-level PR comments are narrowed
  to the current review round by including only non-bot PR comments at or after
  the latest submitted review timestamp on the PR. If no submitted review
  exists, all non-bot top-level PR comments are eligible.
- **One review pass, one harness-authored commit.** The harness runs the same
  patch-mode fallback agent order once, commits only if the agent exits cleanly
  and the worktree changed, and then pushes via the existing upstream-aware
  helper. The command does not auto-resolve threads, post replies, or loop
  until comments disappear.
  - If commit succeeds but push fails, the command reports the failure and
    leaves the local commit in place for manual recovery.

## Subspecs

- [ ] [00 - CLI entry and worktree safety gates](./00-cli-entry-and-worktree-safety-gates.md)
- [ ] [01 - Collect actionable PR review feedback and render the prompt](./01-collect-actionable-pr-review-feedback-and-render-the-prompt.md)
- [ ] [02 - Run the agent, commit, push, and document the workflow](./02-run-the-agent-commit-push-and-document-the-workflow.md)
