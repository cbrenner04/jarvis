---
name: write-sibling-step-id-matcher
---

# Shared write-sibling step-id matcher and linked-row resume routing

## Module-boundary surface

- Execution loop: linked-row minting, write-sibling resolution, and linked-implement resume re-entry in `v2/src/execution/` and `shared/`

## Prerequisites

## Problem

`workflow-runner-resume.ts` defines `isWriteSiblingStepId` locally for sibling lookup and publication resume, while `reconstructWriteResume` in the daemon matches only exact snapshot step ids or a `~shrink` suffix special case. The execution loop mints `~link-N` rows the daemon cannot reconstruct, and `surviving_mutation_failed` review-mutation resume replays the publication tail without redriving the review agent first.

## Decision ledger

- One shared matcher module (`shared/`, composing `shrink-step-id`) owns exact stepId, `<stepId>~link-N`, and `<stepId>~shrink` grammar plus snapshot base-step resolution; rules out each surface re-implementing suffix rules.
- The execution loop imports the shared matcher for row minting, sibling lookup, and resume reconstruction helpers; rules out a private `isWriteSiblingStepId` copy.
- Paused `<stepId>~link-N` resume re-enters the linked implement loop with `specReadRoot` and the active subspec threaded through write-loop input; rules out treating a linked row as a one-off snapshot step with no routing context.
- `surviving_mutation_failed` resume redrives the owning review agent with the surviving-mutation reprompt before mutation re-verification, or settles non-resumable with a named hand-finish action; rules out finalization-only replay that deterministically re-fails the gate (#3395).

## Acceptance criteria

- [ ] A test in `v2/src/execution/workflow-runner-resume.test.ts` proves `surviving_mutation_failed` resume dispatches the review agent with the reprompt before re-running the mutation gate, or settles non-resumable with a named action; it fails against the current finalization-only replay that surfaces `internal_error` from a gate re-check.
- [ ] `v2/src/execution/workflow-runner-resume-structure.test.ts` proves `isWriteSiblingStepId` is absent from `v2/src/execution/` and the shared matcher is imported at every prior call site; it fails while the local copy remains.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — linked-row step-id grammar and the single matcher contract.
- `v2/docs/v1-behaviors.md` — record surviving-mutation resume agent redrive and linked-row matcher ownership.
