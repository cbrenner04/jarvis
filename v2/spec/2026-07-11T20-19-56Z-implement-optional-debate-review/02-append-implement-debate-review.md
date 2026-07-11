# Append implement debate review

Compose the selected post-implement review as one authored workflow step appended
after the implement write path.

## Decisions

- `reviewPasses: 0` produces only the existing implement write workflow; rules out an authored `implement-reviewed` preset.
- Positive counts append exactly one `review-debate` step after implement with `maxCycles` equal to the count; rules out one workflow step per pass.
- Keep shrink inside the implement write path before the appended review; rules out moving shrink after review.
- Run the appended review in the implement run worktree and write its verdict as `verdict-patch.md` beside the executed `index.md`; rules out inheriting the primitive's caller-supplied path implicitly or using a separate review worktree.
- An empty or already-complete index counts as non-completion for review gating — the appended review skips rather than hard-fails; rules out treating an `already_complete` outcome as a review trigger.
- Actuator edits from the appended review receive the same commit handling as implement write edits; rules out an uncommitted or separately-committed review edit path.
- Each cycle overwrites `verdict-patch.md` in place; rules out accumulating per-cycle verdict files.
- Deferred to first consumer: reviewer (adversary/advocate/adjudicator) read-only enforcement relies on the review primitive's existing guarantee — pin when a caller needs it.

## Tasks

- [ ] Make the implement workflow builder validate and consume its resolved review count.
- [ ] For a positive count, load the implement write source and one `review-debate` source together, with `maxCycles` equal to the count.
- [ ] Run the appended review in the implement run worktree and write its verdict as `verdict-patch.md` beside the executed `index.md`, overwritten each cycle.
- [ ] Give actuator review edits the same commit handling as implement write edits.
- [ ] Preserve existing index routing and terminal shrink before workflow advancement reaches debate review; skip the review when the index is empty or already complete.
- [ ] Cover zero and positive composition, review ordering, verdict placement/overwrite, skip-on-non-completion, commit handling, and failure stop behavior.

## Documentation updates

- [ ] Update `v2/docs/workflow-runner.md` with the optional implement review step and its ordering.
- [ ] Update `v2/docs/write-behavior.md` with implement's positive-count completion path.
- [ ] Update `v2/docs/v1-behaviors.md` with the changed v2 implement workflow behavior.

## Acceptance criteria

- [ ] An effective count of `0` runs the existing implement write-and-shrink behavior with no authored review step.
- [ ] A positive effective count runs exactly one bounded `review-debate` step, in the implement run worktree, only after every linked subspec is complete and terminal shrink has completed.
- [ ] The appended review writes `verdict-patch.md` beside the executed `index.md`, overwriting it each cycle, and its actuator edits are committed like implement write edits.
- [ ] A non-complete implement or shrink outcome — including an empty or already-complete index — prevents the appended review from running (skip, not hard-fail).
- [ ] `v2/src/execution/implement-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts` cover composition and ordering.
