# Auto-ready on review-incomplete

## Problem

On a criteria-complete tree whose completion gate passed green, the post-completion review phase
runs. When review exits `11` (`review-incomplete`), `tryFinishSpecIfDone` returns from the
`reviewExitCode !== 0` branch before reaching `maybeMarkReady`, leaving the PR draft. The operator
must run `gh pr ready` by hand even though the gate that gates merge is green. Auto-ready today
fires only on the review-success path (`runPatchReviewPhase` final ready block) or the no-review
path (`maybeMarkReady` in `tryFinishSpecIfDone`).

Review is a quality pass, not a merge gate. A gate-green-but-review-failed run should ready the PR.

## Decisions

Auto-ready reuses the existing `maybeMarkReady` carrier (`selectReadyTier` / `runReadyGateWithTier`); it does not bypass the gate on a stale green record — readying a PR whose live tree is unverified-red is worse than a draft and contradicts the intent's "readied on the strength of the green gate."
Precedence on the recorded green sha:
- Tree unchanged since the recorded green sha → ready directly (skip tier), no quality re-run.
- Tree moved past it (review committed fix-ups) → `maybeMarkReady` re-runs the full ready gate; green readies, red throws → caught as a non-fatal warning, PR stays draft, exit stays `11`.
Auto-ready applies only to exit `11`; blocker (`7`) and interrupt (`130`) are *returned* by `mapReviewExitCode` (not thrown), so they bypass the auto-ready path by construction and still leave the PR draft.
The run still exits `11` / `exitReason` `review-incomplete`; readying the PR does not flip the run to success.
A failure to mark the PR ready is a non-fatal warning, exit stays `11` — matching the existing no-review catch in `tryFinishSpecIfDone`.
When no PR exists for the branch, `maybeMarkReady` throws; the run warns and exits `11` without crashing. (Git-disabled is unreachable: the review phase runs only when git is enabled, so a review exit `11` cannot occur with git off.)
The `review did not complete … The PR is left draft` message is corrected, since the PR is no longer left draft on the unchanged-tree / gate-green auto-ready path.

## Task checklist

- [ ] On review exit `11`, attempt auto-ready via `maybeMarkReady` (same carrier as the no-review/success paths) before returning `11`; wrap in the same non-fatal catch.
- [ ] Scope the auto-ready to exit `11` only; leave `7` and `130` returning early as today.
- [ ] Correct the review-incomplete operator message to reflect the auto-ready attempt.
- [ ] Update `run.test.ts:6306` (quota → review-incomplete, unchanged tree) to expect the PR readied.
- [ ] Reason about `run.test.ts:6249` (review commit *push* failure) separately — local commit moves the tree, remote is stale; confirm it still leaves the PR draft (gate re-run / unsynced remote) and update assertions accordingly.
- [ ] Add coverage for the review-moved-tree fork (fix-ups committed, gate green → readied; gate red → warning + draft) and the no-PR path.
- [ ] Docs: `v1/docs/run-loop.md`, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] On a criteria-complete, completion-gate-green tree, unchanged since the recorded green sha, where the review phase exits `review-incomplete`, `jarvis1 run` marks the draft PR ready before exiting.
- [ ] That run still exits `11` with `exitReason` `review-incomplete`.
- [ ] On a review-incomplete run where review committed fix-ups (tree moved past the recorded green sha): a green re-run of the ready gate readies the PR; a red re-run emits a warning and leaves the PR draft. The PR is never readied on a stale green record.
- [ ] A review blocker exits `7` and a review interrupt exits `130`, each leaving the PR draft (auto-ready does not fire; codes are returned by `mapReviewExitCode`, not thrown).
- [ ] When no PR exists for the branch, the review-incomplete run emits a warning and exits `11` without throwing.
- [ ] When marking the PR ready fails, the run emits a warning and still exits `11`.
- [ ] The review-success and no-review auto-ready paths stay green — `run.test.ts` review-phase and completion-transition ready-gate tests unchanged (behavior preserved on those paths).

## Documentation updates

- `v1/docs/run-loop.md`: review-phase section and stop-conditions table — exit `11` now attempts auto-ready (PR readied on a gate-green tree; left draft only when a review-moved tree re-runs red or marking ready fails).
- `v2/docs/v1-behaviors.md`: record that a review-incomplete (`11`) run on a gate-green tree auto-readies the PR while still exiting `11`, and that a review-moved tree re-runs the ready gate (red → draft).
