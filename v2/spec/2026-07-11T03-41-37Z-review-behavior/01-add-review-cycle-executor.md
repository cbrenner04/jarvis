# Add review cycle executor

Add the standalone critic-to-actuator review loop.

## Decisions

- Use a dedicated review executor; rules out a mode flag on `executeReviewDebate` because review has no advocate or adjudicator.
- Run `critic` then `actuator` in each cycle; rules out parallel roles because the actuator consumes that cycle's critic output.
- Write critic stdout verbatim to `verdictPath`, then use trim only to classify emptiness; rules out normalizing the durable verdict or actuator prompt.
- Stop successfully on an empty verdict and skip the actuator; rules out spending an actuator invocation on a no-op or continuing later cycles.
- Stop on the first critic or actuator binding-chain failure; rules out applying a partial cycle or continuing after failed application.
- Use caller-supplied `maxCycles`, with non-positive values running zero cycles; rules out a hidden convergence limit or validation error.
- Enforce critic read-only behavior as a binding contract, not a runtime sandbox; rules out adding process isolation in this slice.
- Caller owns collision-free `verdictPath` selection; rules out executor-derived paths without a workflow identity contract.
- Deferred to first consumer: whether a prior verdict becomes context for the next critic — pin when a caller needs it.

## Tasks

- Add a review executor with critic and actuator binding chains, verdict output, bounded cycles, and per-cycle results.
- Reuse shared invocation quota fallback for both roles.
- Add co-located executor tests for termination, failures, verbatim handoff, and quota fallthrough.
- Add the review cycle as the durable sibling of review-debate in `v2/docs/write-behavior.md`.

## Acceptance criteria

- [ ] Each cycle invokes the read-only critic, writes its stdout verbatim to `verdictPath`, and passes the same non-empty text verbatim to the actuator.
- [ ] An empty or whitespace-only verdict skips the actuator and ends the loop successfully, including before `maxCycles` when the bound exceeds one.
- [ ] Non-empty verdicts continue through at most `maxCycles`; a non-positive bound performs no invocation or verdict write.
- [ ] Critic failure skips the actuator and later cycles; actuator failure skips later cycles; both identify the failed role and invocation failure kind.
- [ ] Quota exhaustion falls through the supplied binding chain independently for critic and actuator.
- [ ] Co-located tests cover empty-verdict termination, actuator skipping, verbatim file/prompt text, multi-cycle bounds, both mid-cycle failures, and quota fallthrough for both roles.
- [ ] `v2/docs/write-behavior.md` documents the review order, verdict lifecycle, termination, failure, and cycle-bound semantics without duplicating workflow dispatch.

## Documentation updates

- `v2/docs/write-behavior.md` — add the canonical review cycle contract alongside review-debate.
