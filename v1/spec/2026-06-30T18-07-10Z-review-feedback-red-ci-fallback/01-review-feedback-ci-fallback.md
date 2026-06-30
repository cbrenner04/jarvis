# 01 - `review-feedback` CI fallback path

## Problem

When a PR has no open review comments, `jarvis1 review-feedback <worktree>` exits
`no open review comments` even if CI is red. Operators need the existing agent/commit/push loop
routed through failing-check context instead of manual log triage.

## Prerequisites

- Subspec 00 landed: shared CI classification, discriminated HEAD-sha fetch,
  `collectFailingCiContext`, and `renderCiFailurePrompt`.

## Decisions

- Extend `review-feedback`, not a new command — rules out `jarvis1 fix-ci` or a separate
  subcommand.
- Open review comments (any actionable inline thread or top-level comment) keep today's comment
  collection, `renderReviewPrompt`, agent loop, and `address PR review comments` commit — rules
  out merging CI excerpts into comment prompts or dual loops when comments exist.
- No-comments branch performs one HEAD-sha check-runs fetch; the same payload feeds
  `adaptCheckRunsToCiStates` + `classifyCiChecks` and `collectFailingCiContext` — rules out classify
  then refetch.
- No-comments + fetch `{ ok: false }` → exit `1` with stderr context (gh API error, unresolvable
  `origin`, JSON/parse failure, pagination abort) — rules out treating fetch failure as
  `no open review comments` success or a synthetic red agent loop.
- No-comments + fetch `{ ok: true }` with zero check-runs → exit `0` with line body
  `jarvis1 review-feedback: no open review comments` (trailing `\n` per existing convention) and
  no agent spawn — rules out fail-closed agent loop on empty successful fetch.
- No-comments + `green` or `pending` classification → same success exit as zero check-runs — rules
  out `--merge`-style CI polling/waiting when there is nothing to fix yet.
- No-comments + `red` classification → `collectFailingCiContext` on the same fetch payload,
  `renderCiFailurePrompt`, existing patch-mode agent/commit/push loop — rules out a separate
  CI-only actuator lifecycle.
- CI-only commit subject: `address failing CI checks` — rules out reusing `address PR review
  comments` for CI-only fixes.
- CI path shares comment path's post-agent gate: dirty worktree after agent → commit/push; clean
  worktree → exit `1` with `agent run completed with no file changes; no commit created` — rules
  out CI-specific no-op success.
- CI path stdout before agent: `jarvis1 review-feedback: collected <N> failing CI checks for PR #<n>`
  then `jarvis1 review-feedback: review prompt prepared (<chars> chars)` — rules out silent
  fallback indistinguishable from comment mode.
- CI path success tail reuses `jarvis1 review-feedback: committed and pushed review feedback updates via <agent>` — rules out a second success wording for the same commit/push loop.
- `ReviewCommandOptions` gains injectable CI hooks parallel to `collectReviewFeedbackFn` (fetch +
  classify/collect stubs) — rules out live-gh command tests.
- `review-feedback` CI state is HEAD commit check-runs; `triage --merge` polls branch-scoped
  `gh pr checks` — shared classifier vocabulary does not guarantee cross-command alignment.

## Task checklist

- Wire no-comments branch in `v1/src/commands/review-feedback.ts`: single fetch → `{ ok: false }`
  error exit; zero check-runs or green/pending early success exit; red → CI collect (same payload)
  → CI prompt → existing agent/quota/commit/push path with CI commit message.
- Add CI injectable hooks on `ReviewCommandOptions`; preserve comment path when any actionable
  feedback exists regardless of CI state.
- Tests in `review-feedback-command.test.ts` via injected hooks: no-comments+red runs agent and
  commits `address failing CI checks`; no-comments+green/pending and zero check-runs exit `0`
  without agent; comments+red uses comment prompt and `address PR review comments`; fetch
  `{ ok: false }` exits `1`; CI no-op agent exits `1` without commit.
- Update `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [ ] When the PR has open review comments and red CI, `review-feedback` uses the comment prompt and commits `address PR review comments` — unchanged from today's comment path.
- [ ] When the PR has no open review comments and red CI at HEAD, `review-feedback` prints `collected <N> failing CI checks for PR #<n>`, runs the patch-mode agent loop from a CI-failure prompt, commits `address failing CI checks` on change, pushes, prints `committed and pushed review feedback updates via <agent>`, and exits `0`.
- [ ] When the PR has no open review comments and CI is green, pending, or a successful fetch returns zero check-runs at HEAD, `review-feedback` exits `0` with line body `jarvis1 review-feedback: no open review comments` (trailing newline per existing convention) and does not spawn an agent.
- [ ] When HEAD-sha check-runs fetch returns `{ ok: false }` (gh API error, unresolvable `origin`, JSON/parse failure, or pagination abort) on the no-comments branch, `review-feedback` exits `1` with a surfaced error and does not report `no open review comments`.
- [ ] When the CI fallback agent makes no file changes, `review-feedback` exits `1` with `agent run completed with no file changes; no commit created` and does not commit.
- [ ] `review-feedback-command.test.ts` `"no actionable comments exits 0 with no-open-comments message"`, `"lock contention exits through normal lock failure path"`, `"no-op agent exits non-zero and does not commit"`, `"falls through failing/quota agent to later success and commits once"`, and `"all agents quota-exhausted exits non-zero with no commit"` stay green aside from new CI-fallback cases above.

## Documentation updates

- `v2/docs/v1-behaviors.md`: document `review-feedback` comment priority; no-comments CI-red
  fallback (single HEAD-sha check-runs fetch, bounded excerpts, CI commit message, stdout lines);
  zero-check-runs / green / pending success exit; fetch-error exit `1`; HEAD-sha check-runs vs
  `triage --merge` branch-scoped `gh pr checks` source divergence.
