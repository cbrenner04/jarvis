---
name: implement-verifies-mutations-in-loop
---

# Verify diff-derived mutations in the implement loop, not only at publication

Unsplit rationale: In-loop verification, live-agent reprompt wiring (including `surviving_mutation_reprompt` log event, `WriteLoopInput` reprompt context, and daemon resume replay mirroring `landing_contract_reprompt` / `staged_markdown_lint_reprompt`), and publication confirm-only re-check land on the implement write loop, its completion-publication tail, and incidental persistence/daemon resume seams; no CLI boundary changes.

## Primary implementation surface

- Execution-loop implement write loop and completion verification in `v2/src/execution/`

## Prerequisites

- The diff-derived verifier accepts an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive scoped to the candidate's file, physical line, and full mutation string.
- Equivalent-mutation acceptance reports each accepted site's file, line, mutation, and reason without running a killing test for that candidate.
- Malformed, mismatched, or absent equivalent-mutation directives leave normal mutation testing blocking.

## Problem

- Diff-derived mutation verification runs only at ready finalization after publication, so every uncovered changed guard strands the run and forces operator hand-finish once the agent has already claimed `done`.

## Behavior

- For implement (`patch.prompt.body`) complete iterations only: after intent-split landing and plan-draft staged-Markdown lint gates when those apply, after coverage advisory, and before per-iteration checkpoint commit, completion commit, and `publishWithReadyRepair`, run the existing diff-derived mutation verifier with its current bounds (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`). Intent-split and plan-draft complete paths gain no in-loop mutation gate.
- A surviving mutation reprompts the live agent through the same in-loop machinery as landing and blocker reprompts (including pause/resume replay of reprompt context), naming the mutation string and source site and both remedies: add or extend a co-located killing test, or (only for a provably behavior-neutral mutation) place an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive on the mutated physical line.
- The reprompt consumes the normal iteration budget; budget exhaustion settles exactly as today.
- Publication-time diff-derived verification stays blocking but becomes confirm-only: it re-checks for mutants introduced between `done` and publication and is no longer where problems are first discovered; repair-introduced publication survivors still settle `surviving_mutation_failed` and resume through the existing review `write.mutation-repair` machinery.
- Reuse `verifyDiffDerivedMutations` unchanged; new work is lifecycle call site, reprompt wiring, and landing/staged-Markdown-parity resume seams.

## Decision ledger

- Run diff-derived verification on implement complete after landing/staged-Markdown gates and coverage advisory, before checkpoint commit, completion commit, and `publishWithReadyRepair`; rules out first discovery at publication or verification after completion commit.
- Reprompt a surviving mutation through the existing in-loop landing/blocker reprompt path, with `surviving_mutation_reprompt` log event, `WriteLoopInput` context, and daemon resume replay; consume the normal iteration budget; rules out a bespoke budget, silent skip, or pause/resume dropping reprompt context.
- Keep publication-time verification blocking but confirm-only for repair-introduced mutants; rules out removing the publication gate.
- Publication-time `surviving_mutation_failed` for repair-introduced mutants keeps existing review `write.mutation-repair` resume machinery; rules out terminal strand with only `jarvis run resume` as the recovery path.
- Reuse `verifyDiffDerivedMutations` unchanged and add only call-site, reprompt, and resume-parity wiring; rules out a second verifier implementation.

## Acceptance criteria

- [ ] A `write-loop.test.ts` regression proves a surviving mutation at implement `done` triggers a reprompt naming the mutation and source site and that a subsequent iteration adding a killing test completes the run without a publication-time strand; it fails against the pre-fix loop that only verifies at publication.
- [ ] A regression proves publication-time verification still blocks on a mutation introduced after the in-loop pass (repair-introduced mutant), settling `surviving_mutation_failed` and admitting review `write.mutation-repair` resume; it fails against the pre-fix publication-only discovery path.
- [ ] A `write-loop.test.ts` regression proves the in-loop reprompt honors an exact `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive (accepts that exact site and mutation, does not reprompt) and that reprompt-budget exhaustion settles as today; it fails against the pre-fix loop that only verifies at publication.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the implement loop verifies diff-derived mutations at `done` and reprompts on a survivor; publication verification is confirm-only.
- `v2/docs/workflow-runner.md` — completion-verification ordering: in-loop discovery before review/publication, publication re-check after.
- `v2/docs/operator-runbook.md` — recovery: mutation misses now reprompt the live agent rather than stranding post-publication; a publication-time survivor is a repair-introduced mutant.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement completion mutation-verification lifecycle.
