# Append implement debate review

Build the selected post-implement review as an authored workflow step.

## Decisions

- `reviewPasses: 0` produces only the existing implement write workflow; rules out an authored `implement-reviewed` preset.
- Positive counts append exactly one `review-debate` step after implement; rules out one workflow step per pass.
- The appended step uses `patch.prompt.review.*` and `verdict-patch.md`; rules out a parallel implement debate prompt family.
- Keep shrink inside the implement write path before the appended review; rules out moving shrink after review.

## Tasks

- [ ] Make the implement workflow builder validate and consume its resolved review count.
- [ ] For a positive count, load the implement write source and one `review-debate` source together, with `maxCycles` equal to the count.
- [ ] Bind the debate roles to the existing patch review prompt IDs and place the verdict beside the executed spec as `verdict-patch.md`.
- [ ] Preserve existing index routing and terminal shrink before workflow advancement reaches debate review.
- [ ] Cover zero and positive composition, loader role bindings, review ordering, prompt/verdict contracts, and failure stop behavior.

## Documentation updates

- [ ] Update `v2/docs/workflow-runner.md` with the optional implement review step and its ordering.
- [ ] Update `v2/docs/write-behavior.md` with implement's positive-count completion path.
- [ ] Update `v2/docs/v1-behaviors.md` with the changed v2 implement workflow behavior.

## Acceptance criteria

- [ ] An effective count of `0` runs the existing implement write-and-shrink behavior with no authored review step.
- [ ] A positive effective count runs exactly one bounded `review-debate` step only after every linked subspec is complete and terminal shrink has completed.
- [ ] The implement review step runs the existing adversary, advocate, adjudicator, and actuator prompt roles and writes `verdict-patch.md` beside the executed spec.
- [ ] A non-complete implement or shrink outcome prevents the appended review from running.
- [ ] `v2/src/execution/implement-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts` cover composition and ordering.
