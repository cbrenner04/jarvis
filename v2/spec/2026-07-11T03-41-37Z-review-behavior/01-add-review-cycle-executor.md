# Add review cycle executor

Add the standalone critic-to-actuator review loop.

## Decisions

- Use a dedicated review executor; rules out a mode flag on `executeReviewDebate` because review has no advocate or adjudicator.
- Run `critic` then `actuator` in each cycle; rules out parallel roles because the actuator consumes that cycle's critic output.
- Write critic stdout verbatim to `verdictPath`, then use trim only to classify emptiness; rules out normalizing the durable verdict or actuator prompt.
- Pass a non-empty verdict as the actuator's entire prompt; rules out a separate actuator prompt or implicit composition.
- Stop successfully on an empty verdict and skip the actuator; rules out spending an actuator invocation on a no-op or continuing later cycles.
- Stop on the first critic or actuator binding-chain failure; rules out applying a partial cycle or continuing after failed application.
- Require caller-supplied `maxCycles` to be a finite non-negative integer and throw `RangeError` before file or invocation work otherwise; rules out coercing fractions, `NaN`, infinities, or negatives and rules out an executor default.
- Make read-only critic operation a caller obligation; rules out claiming ordinary invocation bindings prevent writes or adding a sandbox in this slice.
- Invalidate `verdictPath` before each critic invocation; rules out leaving a prior cycle or run's verdict visible when the critic fails.
- Map verdict invalidation/write errors to executor `invocation_failure` with failure kind `error`; rules out uncategorized thrown I/O failures.
- Count a cycle when critic invocation begins and record that cycle even when critic or actuator fails; rules out counting only completed cycles.
- Map abort during either role through that role's terminal `error` result; rules out a review-only abort outcome. A verdict already written before actuator abort remains current.
- Caller owns collision-free `verdictPath` selection; rules out executor-derived paths without a workflow identity contract.
- Deferred to first consumer: whether a prior verdict becomes context for the next critic — pin when a caller needs it.

## Tasks

- Add a review executor with critic and actuator binding chains, validated cycle bound, stale-verdict invalidation, verdict I/O failure results, and per-cycle accounting.
- Reuse shared invocation quota fallback for both roles.
- Add co-located executor tests for termination, failures, verbatim handoff, and quota fallthrough.
- Add the review cycle as the durable sibling of review-debate in `v2/docs/write-behavior.md`.

## Acceptance criteria

- [ ] Each cycle invokes the caller-constrained critic, writes its stdout verbatim to `verdictPath`, and passes the same non-empty text as the actuator's entire prompt.
- [ ] An empty or whitespace-only verdict skips the actuator and ends the loop successfully, including before `maxCycles` when the bound exceeds one.
- [ ] Non-empty verdicts continue through at most `maxCycles`; zero performs no invocation or verdict write, while negative, fractional, `NaN`, and infinite values throw `RangeError` before side effects.
- [ ] Each critic start creates one cycle result; critic- and actuator-failed cycles count, while pre-cycle validation or verdict invalidation failure consumes zero cycles.
- [ ] Before each critic starts, prior verdict content is invalidated; critic failure cannot expose stale content as the current verdict.
- [ ] Critic failure skips the actuator and later cycles; actuator failure skips later cycles; both identify the failed role and invocation failure kind.
- [ ] Verdict invalidation or write failure stops the loop as `invocation_failure` with failure kind `error` and does not run the actuator or later cycles.
- [ ] Abort during critic or actuator maps to that role's `error` failure and stops later work; a verdict written before actuator abort remains at `verdictPath`.
- [ ] Quota exhaustion falls through the supplied binding chain independently for critic and actuator.
- [ ] Co-located tests cover emptiness, verbatim entire-prompt handoff, valid and invalid bounds, cycle accounting, stale-verdict invalidation, verdict I/O failures, both role failures and aborts, and quota fallthrough for both roles.
- [ ] `v2/docs/write-behavior.md` documents the review order, caller-owned read-only boundary, verdict lifecycle, termination, I/O/role/abort failure, and cycle-bound/accounting semantics without duplicating workflow dispatch.

## Documentation updates

- `v2/docs/write-behavior.md` — add the canonical review cycle contract alongside review-debate.
