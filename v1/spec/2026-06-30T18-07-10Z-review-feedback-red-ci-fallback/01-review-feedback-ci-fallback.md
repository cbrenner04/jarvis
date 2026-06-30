# 01 - `review-feedback` CI fallback path

## Problem

When a PR has no open review comments, `jarvis1 review-feedback <worktree>` exits
`no open review comments` even if CI is red. Operators need the existing agent/commit/push loop
routed through failing-check context instead of manual log triage.

## Prerequisites

- Subspec 00 landed: shared CI classification, `collectFailingCiContext`, and
  `renderCiFailurePrompt`.

## Decisions

- Extend `review-feedback`, not a new command — rules out `jarvis1 fix-ci` or a separate
  subcommand.
- Open review comments (any actionable inline thread or top-level comment) keep today's comment
  collection, `renderReviewPrompt`, agent loop, and `address PR review comments` commit — rules
  out merging CI excerpts into comment prompts or dual loops when comments exist.
- No-comments branch classifies HEAD-sha CI via shared `classifyCiChecks` — rules out a parallel
  check fetch or vocabulary.
- No-comments + `red` → collect failing CI context, `renderCiFailurePrompt`, run existing
  patch-mode agent/commit/push loop — rules out a separate CI-only actuator lifecycle.
- No-comments + `green` or `pending` → exit `0` with stdout exactly
  `jarvis1 review-feedback: no open review comments` and no agent spawn — rules out
  `--merge`-style CI polling/waiting when there is nothing to fix yet.
- CI-only commit subject: `address failing CI checks` — rules out reusing `address PR review
  comments` for CI-only fixes.
- CI path stdout includes a collection summary (failing check count) before the existing
  `review prompt prepared` line — rules out silent fallback indistinguishable from comment mode.
- CI check fetch/classification failures surface as command errors (exit `1`) with stderr context —
  rules out treating fetch failure as `no open review comments` success.

## Task checklist

- Wire no-comments branch in `v1/src/commands/review-feedback.ts`: classify → green/pending early
  exit; red → CI collect → CI prompt → existing agent/quota/commit/push path with CI commit
  message.
- Preserve comment path when any actionable feedback exists regardless of CI state.
- Tests in `review-feedback-command.test.ts`: no-comments+red runs agent and commits
  `address failing CI checks`; no-comments+green/pending exits `0` without agent; comments+red
  uses comment prompt and `address PR review comments`; fetch/classification error exits `1`.
- Update `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [ ] When the PR has open review comments and red CI, `review-feedback` uses the comment prompt and commits `address PR review comments` — unchanged from today's comment path.
- [ ] When the PR has no open review comments and red CI at HEAD, `review-feedback` runs the patch-mode agent loop from a CI-failure prompt, commits `address failing CI checks` on change, pushes, and exits `0`.
- [ ] When the PR has no open review comments and CI is green or pending at HEAD, `review-feedback` exits `0` with `jarvis1 review-feedback: no open review comments` and does not spawn an agent.
- [ ] When CI check fetch or classification fails on the no-comments branch, `review-feedback` exits `1` with a surfaced error and does not report `no open review comments`.
- [ ] `review-feedback-command.test.ts` preservation cases (worktree gates, quota fallback, lock busy, no-comments-without-CI) stay green aside from new CI-fallback cases above.

## Documentation updates

- `v2/docs/v1-behaviors.md`: document `review-feedback` comment priority, no-comments CI-red
  fallback (HEAD-sha classification, bounded excerpts, CI commit message), and unchanged
  green/pending/no-comment success exit.
