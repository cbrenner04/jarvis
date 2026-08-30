---
name: implement-verifies-mutations-in-loop
---

# Verify diff-derived mutations in the implement loop, not only at publication

Unsplit rationale: In-loop verification, live-agent reprompt wiring, and publication confirm-only re-check all land on the implement write loop and its completion-publication tail; no persistence, daemon, or CLI boundary changes.

## Primary implementation surface

- Execution-loop implement write loop and completion verification in `v2/src/execution/`

## Prerequisites

- The diff-derived verifier accepts an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive scoped to the candidate's file, physical line, and full mutation string.
- Equivalent-mutation acceptance reports each accepted site's file, line, mutation, and reason without running a killing test for that candidate.
- Malformed, mismatched, or absent equivalent-mutation directives leave normal mutation testing blocking.

## Problem

- Diff-derived mutation verification runs only at ready finalization after publication, so every uncovered changed guard strands the run and forces operator hand-finish once the agent has already claimed `done`.

## Behavior

- When the implement write loop settles `done`, before review or publication, run the existing diff-derived mutation verifier with its current bounds (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`).
- A surviving mutation reprompts the live agent through the same in-loop machinery as landing and blocker reprompts, naming the mutation string and source site and both remedies: add or extend a co-located killing test, or (only for a provably behavior-neutral mutation) place an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive on the mutated physical line.
- The reprompt consumes the normal iteration budget; budget exhaustion settles exactly as today.
- Publication-time diff-derived verification stays blocking but becomes confirm-only: it re-checks for mutants introduced between `done` and publication and is no longer where problems are first discovered.
- Reuse the existing diff-derived verifier and its seams unchanged; only the lifecycle call site and reprompt wiring are new.

## Decision ledger

- Run diff-derived verification at implement `done` before review/publication; rules out leaving first discovery at publication.
- Reprompt a surviving mutation through the existing in-loop landing/blocker reprompt path and consume the normal iteration budget; rules out a bespoke budget or silent skip.
- Keep publication-time verification blocking but confirm-only for repair-introduced mutants; rules out removing the publication gate.
- Reuse `verifyDiffDerivedMutations` unchanged and add only call-site and reprompt wiring; rules out a second verifier implementation.

## Acceptance criteria

- [ ] A write-loop test proves a surviving mutation at `done` triggers a reprompt naming the mutation and source site and that a subsequent iteration adding a killing test completes the run without a publication-time strand; it fails against the pre-fix loop that only verifies at publication.
- [ ] A test proves publication-time verification still blocks on a mutation introduced after the in-loop pass (repair-introduced mutant), settling `surviving_mutation_failed`.
- [ ] A test proves the in-loop reprompt honors an exact `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive (accepts that exact site and mutation, does not reprompt) and that reprompt-budget exhaustion settles as today.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the implement loop verifies diff-derived mutations at `done` and reprompts on a survivor; publication verification is confirm-only.
- `v2/docs/workflow-runner.md` — completion-verification ordering: in-loop discovery before review/publication, publication re-check after.
- `v2/docs/operator-runbook.md` — recovery: mutation misses now reprompt the live agent rather than stranding post-publication; a publication-time survivor is a repair-introduced mutant.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement completion mutation-verification lifecycle.
