# Execution loop adopts shared matcher

## Problem

`isWriteSiblingStepId` lives privately in `workflow-runner-resume.ts` while `workflow-runner.ts` mints `~link-N` rows with inline suffix concatenation. Sibling lookup and row minting can drift from daemon shrink handling because there is no single imported contract.

## Decisions

- Delete the local `isWriteSiblingStepId` from `v2/src/execution/` and import `shared/write-sibling-step-id.ts` at every prior call site (`workflow-runner-resume.ts` sibling selection, `workflow-runner.ts` linked-row minting, and any other execution-loop `~link-` / `~shrink` checks); rules out a private execution-loop copy.
- Behavior-preserving for sibling selection and minting: `resolveDurableWriteSiblingRun` keeps exact + `~link-N` tie-breaking only — shared shrink matching is for snapshot base-step resolution, not sibling selection; rules out shrink rows entering sibling tie-breaking when the matcher is adopted.
- Behavior-preserving otherwise: linked-implement and review-mutation sibling resolution semantics stay unchanged aside from the shared import; rules out changing which completed write row wins sibling ties.

## Tasks

- [ ] Replace `isWriteSiblingStepId` and inline `~link-` / `~shrink` step-id checks under `v2/src/execution/` with imports from `shared/write-sibling-step-id.ts`.
- [ ] Extend `workflow-runner-resume-structure.test.ts` to assert `isWriteSiblingStepId` is absent from `v2/src/execution/` and that `workflow-runner-resume.ts` and `workflow-runner.ts` import the shared matcher.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-resume-structure.test.ts` proves `isWriteSiblingStepId` is absent from `v2/src/execution/` and the shared matcher is imported at every prior call site; it fails while the local copy in `workflow-runner-resume.ts` remains.
- [ ] `v2/docs/v1-behaviors.md` records that write-sibling step-id matching (`~link-N`, `~shrink`, exact) is owned by `shared/write-sibling-step-id.ts`.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — linked-row matcher ownership.
