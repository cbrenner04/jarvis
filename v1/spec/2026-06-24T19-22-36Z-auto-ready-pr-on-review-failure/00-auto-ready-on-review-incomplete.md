# Auto-ready on review-incomplete

## Problem

On a criteria-complete tree whose completion gate passed green, the post-completion review phase
runs. When review exits `11` (`review-incomplete`), `completion-pipeline.ts:550` returns before any
auto-ready, leaving the PR draft. The operator must run `gh pr ready` by hand even though the gate
that gates merge is green. Auto-ready today fires only on the review-success path
(`review.ts:1133`, the final ready block) or the no-review path
(`completion-pipeline.ts:561`, `maybeMarkReady`).

Review is a quality pass, not a merge gate. A gate-green-but-review-failed run should ready the PR.

## Decisions

Auto-ready readies on the strength of the recorded green completion gate; it must not require re-running review or quality work as a precondition — else a review-mutated red tree would leave the PR draft and defeat the intent.
Auto-ready applies only to exit `11` (review-incomplete); blocker (`7`) and interrupt (`130`) — preserved by `mapReviewExitCode` — still leave the PR draft.
The run still exits `11` / `exitReason` `review-incomplete`; readying the PR does not flip the run to success.
A failure to mark the PR ready is a non-fatal warning, exit stays `11` — matching the existing no-review catch at `completion-pipeline.ts:575`.
When git is disabled, no PR exists, or the PR is already ready, the run exits `11` without throwing.
The `review did not complete … The PR is left draft` message (`completion-pipeline.ts:555`) is corrected, since the PR is no longer left draft on the auto-ready path.

## Task checklist

- [ ] On review exit `11`, attempt auto-ready (same readiness as the no-review/success paths) before returning `11`.
- [ ] Scope the auto-ready to exit `11` only; leave `7` and `130` returning early as today.
- [ ] Correct the review-incomplete operator message to reflect the readied PR.
- [ ] Update the two `run.test.ts` review-failure tests (`:6249`, `:6306`) and add coverage for the warning / no-PR / git-disabled paths.
- [ ] Docs: `v1/docs/run-loop.md`, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] On a criteria-complete, completion-gate-green tree where the post-completion review phase exits `review-incomplete`, `jarvis1 run` marks the draft PR ready before exiting.
- [ ] That run still exits `11` with `exitReason` `review-incomplete`.
- [ ] A review blocker exits `7` and a review interrupt exits `130`, each leaving the PR draft (auto-ready does not fire).
- [ ] When auto-ready cannot run (git disabled, or no PR for the branch), the review-incomplete run exits `11` without throwing.
- [ ] When marking the PR ready fails, the run emits a warning and still exits `11`.
- [ ] The review-success and no-review auto-ready paths stay green — `run.test.ts` review-phase and completion-transition ready-gate tests unchanged (behavior preserved on those paths).

## Documentation updates

- `v1/docs/run-loop.md`: review-phase section and stop-conditions table — exit `11` now readies the PR (no longer "PR stays draft").
- `v2/docs/v1-behaviors.md`: record that a review-incomplete (`11`) run on a gate-green tree auto-readies the PR while still exiting `11`.
