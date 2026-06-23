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
- The discriminated code is produced **at the review phase's own return sites**, not by a new caller-side classifier: `runPatchReviewPhase` returns `11` directly at each review-execution-failure return (the `runReview`-failure path ~line 1112, both review-phase idle-timeout returns ~1109/1120, and the `ReviewTerminalError` infra path ~1123); it keeps returning `7` at the blocker site (~633) and `1` at its two gate-red sites (~774, ~1173). `completion-pipeline.ts` propagates the integer unchanged — no new caller contract. Ruling out: a caller-side "classify the phase's exit" layer, which duplicates knowledge the phase already has at its source sites.
- `review-incomplete` covers only review-execution failures: all review agents quota-exhausted (incl. the actuator no-agents exit-`2` path), review-phase idle-timeout, `model_config`, and review/actuator infra/commit errors. A blanket "any non-zero review exit → review-incomplete" would mislabel substantive outcomes.
- Only the **review-phase** idle-timeout return sites remap to `11`; implementation-phase idle-timeout (exit `8`/`timeout`) is unchanged — `8` is shared and must not be globally rerouted.
- A **blocker that fails to commit** (`review-blocker-commit-failed`, ~line 630) maps to `11`, not `1` — that is an infra failure of review running to completion, not a blocker verdict. Ruling out: defaulting it into the "gate-red stays `1`" bucket, which would mislabel an infra failure as a red tree.
- A review-raised blocker that *does* commit stays exit `7` (`blocked`) — review succeeding at flagging a real issue, not review failing to run.
- A ready gate going red (review baseline gate ~774, or review final gate after the actuator's own commits ~1173) stays exit `1` (`error`) — a red tree is a real error regardless of how review was entered. Both paths are reachable: `--resume-review` (in scope) can re-enter against a stale/red tree (baseline), and the final gate runs after the actuator's commits (final). Ruling out: treating baseline-gate-red as an unreachable backstop — it is reachable via resume.
- An escaped (non-`ReviewTerminalError`) throw from the review phase, caught by `completion-pipeline.ts` (~line 426-427, currently sets `reviewExitCode = 1`), maps to `11` — it is a genuine "review couldn't run" infra failure, not a red tree.
- Exit `11` is a harness-only sentinel: add `11` to `RESERVED_REVIEW_EXIT_CODES` (`v1/src/modes/review/run.ts`) so a reviewer agent CLI that coincidentally exits `11` collapses to `1` (`error`) and is never misread as `review-incomplete`. Ruling out: leaving `11` unreserved, which lets a stray agent exit impersonate the sentinel.
- Applies on both the normal completion path and `--resume-review`; resume re-enters the same review phase, so it must report the same outcome.
- On `review-incomplete` the PR stays draft and implementation commits are untouched — no `gh pr ready`. Auto-readying a gate-green tree on review failure is explicitly out of scope.
- Operator message is a **generic** `review-incomplete` notice (PR left draft; recover via `--resume-review` or manual finalize). It does not re-derive the specific failure reason — the stop message is built from the exit integer, which cannot carry quota-vs-commit-vs-timeout. The specific reason remains visible in the stderr lines the review phase already fanned out before returning. Ruling out: an AC promising a reason-naming message with no carrier to supply it.

## Task checklist

- [ ] Return `11` directly at the review-execution-failure return sites of `runPatchReviewPhase` (`runReview`-failure, both review-phase idle-timeout sites, `ReviewTerminalError` infra incl. `review-blocker-commit-failed`, actuator no-agents); keep `7` at the committed-blocker site and `1` at the two gate-red sites.
- [ ] Map the escaped-throw catch in `completion-pipeline.ts` (currently `reviewExitCode = 1`) to `11`.
- [ ] Add `11` to `RESERVED_REVIEW_EXIT_CODES` (`v1/src/modes/review/run.ts`) so a coincidental agent exit `11` collapses to `1`.
- [ ] Add `case 11: return "review-incomplete"` to `mapExitCodeToReason` (`v1/src/modes/patch/run.ts`).
- [ ] Emit a generic `review-incomplete` operator message (PR left draft; recovery via `--resume-review` or manual finalize) on the `11` stop.
- [ ] Update the contradicted end-to-end test `run.test.ts` (`review-agent quota exhaustion exits 2 and leaves the PR draft`, `v1/test/run.test.ts` ~line 6189) to expect exit `11` / `review-incomplete` — this scenario's exit changes from `2` to `11`.
- [ ] Update `v1/docs/run-loop.md` exit-code table and review-phase section.
- [ ] Update `v2/docs/v1-behaviors.md` review-phase entries (quota exit `2`, resume-review outcomes) for the new exit `11`.

## Acceptance criteria

- [ ] When the post-completion review phase fails because all review agents are quota-exhausted on a criteria-complete, completion-gate-green tree, `jarvis1 run` exits `11` with `exitReason` `review-incomplete`.
- [ ] A review-phase idle-timeout, `model_config` error, review/actuator commit failure, or a `review-blocker-commit-failed` on a gate-green tree also exits `11` / `review-incomplete` (not `8`/`3`/`1`).
- [ ] A review-phase throw that escapes to the completion pipeline exits `11` / `review-incomplete`, not `1`.
- [ ] A reviewer agent CLI that coincidentally exits `11` is collapsed to `1` (`error`), not reported as `review-incomplete`.
- [ ] On a `review-incomplete` stop the draft PR is left draft and implementation commits are intact (no `gh pr ready` is issued).
- [ ] The `review-incomplete` stop prints a generic operator message stating review did not complete, the PR is left draft, and recovery is `--resume-review` or manual finalize.
- [ ] `--resume-review` runs that fail review execution on an already-complete tree also exit `11` / `review-incomplete`.
- [ ] A committed review-raised blocker still exits `7` (`blocked`) — `run.test.ts` blocker test (`completion: blocker added during fix-up iteration stops with exit 7`) stays green; review-blocker behavior is unchanged.
- [ ] A review final (or baseline) ready gate going red still exits `1` (`error`); `run.test.ts` review-final tests (`common path with review: one full ready…`, `when tree is unchanged, review final skips ready…`) stay green.
- [ ] The end-to-end review-quota test (`review-agent quota exhaustion exits 2 and leaves the PR draft`) is updated to assert exit `11` / `review-incomplete`.
- [ ] `exitReason` `review-incomplete` (exit `11`) is documented in the `v1/docs/run-loop.md` "Stop conditions and exit codes" table and the review-phase section.

## Documentation updates

- `v1/docs/run-loop.md`: add exit `11` / `review-incomplete` to the stop-conditions table; note in the review-phase section which review failures surface as `review-incomplete` vs the preserved `7`/`1` cases, and the recovery path.
- `v2/docs/v1-behaviors.md`: revise the review-phase entries that record review quota as exit `2` and `--resume-review` outcome preservation to reflect exit `11` / `review-incomplete` for completion-path and resume-review review-execution failures (this changes existing v1 behavior).
