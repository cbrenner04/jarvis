# review-incomplete exit reason for failed post-completion review

## Problem

When a spec reaches criteria-complete, the completion ready gate is green, and the
post-completion review phase then fails to run to completion (e.g. every review role
quota-exhausts), `jarvis1 run` returns the review phase's raw exit code. That maps to a
generic `exitReason` (`error`, `quota-exhausted`, …), so the operator can't tell "code is
broken" from "code is fine, review couldn't run" without reading the log — even though the
implementation commits and draft PR are intact.

Today the review phase (`runPatchReviewPhase`, `v1/src/modes/patch/review.ts`) returns a bare
exit code that `completion-pipeline.ts` propagates verbatim (line ~429-431), and `run.ts`
`mapExitCodeToReason` has no review-specific reason.

## Decisions

- New exit code `11` / `exitReason` `review-incomplete`; reuse no existing code — overloading exit `1`/`2` is what hides the distinction today.
- `review-incomplete` covers only review-execution failures: all review agents quota-exhausted, review idle-timeout, `model_config`, and review/actuator infra/commit errors. A blanket "any non-zero review exit → review-incomplete" would mislabel substantive outcomes.
- A review-raised blocker stays exit `7` (`blocked`) — it is review succeeding at flagging a real issue, not review failing to run.
- A ready gate going red (review baseline gate, or review final gate after the actuator's own commits) stays exit `1` (`error`) — that is a red tree, not a review-only failure. The completion gate already guarantees green before review, so the baseline path is the documented unreachable backstop; the final-gate path means review's actuator broke the tree.
- Applies on both the normal completion path and `--resume-review`; resume re-enters the same review phase on an already-complete, gate-green tree, so it must report the same outcome.
- On `review-incomplete` the PR stays draft and implementation commits are untouched — no `gh pr ready`. Auto-readying a gate-green tree on review failure is explicitly out of scope.
- Operator message names the underlying review failure reason and the recovery path: re-run with `--resume-review`, or finalize the PR manually.

## Task checklist

- [ ] Classify `runPatchReviewPhase` failures into review-execution failures vs ready-gate-red so the caller can distinguish them.
- [ ] Map review-execution failure on a gate-green, criteria-complete tree to exit `11` in the completion pipeline; keep blocker (`7`) and ready-gate-red (`1`) as-is.
- [ ] Add `case 11: return "review-incomplete"` to `mapExitCodeToReason` (`v1/src/modes/patch/run.ts`).
- [ ] Emit an operator message naming the review failure reason + recovery path on the `review-incomplete` stop.
- [ ] Update `v1/docs/run-loop.md` exit-code table and review-phase section.
- [ ] Update `v2/docs/v1-behaviors.md` review-phase entries (quota exit `2`, resume-review outcomes) for the new exit `11`.

## Acceptance criteria

- [ ] When the post-completion review phase fails because all review agents are quota-exhausted on a criteria-complete, completion-gate-green tree, `jarvis1 run` exits `11` with `exitReason` `review-incomplete`.
- [ ] A review idle-timeout, `model_config` error, or review/actuator commit failure on a gate-green tree also exits `11` / `review-incomplete` (not `8`/`3`/`1`).
- [ ] On a `review-incomplete` stop the draft PR is left draft and implementation commits are intact (no `gh pr ready` is issued).
- [ ] The `review-incomplete` stop prints an operator message naming the underlying review failure reason and pointing to recovery (`--resume-review` or manual finalize).
- [ ] `--resume-review` runs that fail review execution on an already-complete, baseline-green tree also exit `11` / `review-incomplete`.
- [ ] A review-raised blocker still exits `7` (`blocked`) — `run.test.ts` blocker test (`completion: blocker added during fix-up iteration stops with exit 7`) stays green; review-blocker behavior is unchanged.
- [ ] A review final ready gate going red still exits `1` (`error`); `run.test.ts` review-final tests (`common path with review: one full ready…`, `when tree is unchanged, review final skips ready…`) stay green.
- [ ] `exitReason` `review-incomplete` (exit `11`) is documented in the `v1/docs/run-loop.md` "Stop conditions and exit codes" table and the review-phase section.

## Documentation updates

- `v1/docs/run-loop.md`: add exit `11` / `review-incomplete` to the stop-conditions table; note in the review-phase section which review failures surface as `review-incomplete` vs the preserved `7`/`1` cases, and the recovery path.
- `v2/docs/v1-behaviors.md`: revise the review-phase entries that record review quota as exit `2` and `--resume-review` outcome preservation to reflect exit `11` / `review-incomplete` for completion-path and resume-review review-execution failures (this changes existing v1 behavior).
