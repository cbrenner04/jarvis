# Shared write-sibling step-id matcher and linked-row resume routing

Execution-loop duplication: `workflow-runner-resume.ts` defines `isWriteSiblingStepId` locally, mints `~link-N` rows, and lacks paused linked-row write-loop reconstruction; `surviving_mutation_failed` review-mutation resume replays publication finalization without auto-derived `write.mutation-repair` when `deps.mutationRepair` is omitted. Daemon `reconstructWriteResume` intake for `~link-N` is out of scope — deferred to first consumer in `03` (operator `jarvis run resume` on `implement~link-N` may still fail after this spec completes).

- [x] [00 - Shared write-sibling step-id matcher](./00-shared-write-sibling-step-id-matcher.md)
- [x] [01 - Execution loop adopts shared matcher](./01-execution-loop-adopts-shared-matcher.md)
- [x] [02 - Surviving-mutation resume publication-time repair](./02-surviving-mutation-resume-agent-redrive.md)
- [ ] [03 - Linked-row paused resume reconstruction](./03-linked-row-paused-resume-reconstruction.md)
