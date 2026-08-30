# Verify diff-derived mutations in the implement loop, not only at publication

## Problem

Diff-derived mutation verification fires only at ready finalization (post-publication). Every uncovered changed guard therefore becomes a stranded run plus an operator hand-finish — the dominant implement-throughput blocker this session (see report `reports/20260830T144234Z-overnight-mutation-gate.md`: 3 implements stranded, `durable-run-backed` #3173 review-SHIP but stranded on mutation whack-a-mole). The `retire-mutation-checkpoint-dsl` regression proved the underlying lesson: authoring and enforcement must bind at the same lifecycle point. Right now the agent claims `done`, publication happens, and only then does the gate discover the miss — by which point the agent is gone and the operator pays.

## Decisions

- Run the diff-derived verifier at implement completion — when the agent claims `done`, before review/publication. It is cheap now: co-located killing tests only, bounded candidate count and wall clock (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`). Rules out leaving discovery at publication.
- A surviving mutation reprompts the live agent — same machinery as the landing/blocker reprompts — with the mutation string and source site, naming both remedies: add or extend a co-located killing test, or (only for a provably behavior-neutral mutation) the `// mutation-equivalent: <reason>` directive from [[mutation-gate-equivalent-mutation-escape-hatch]]. The reprompt consumes the normal iteration budget; budget exhaustion settles exactly as today. Rules out a new bespoke budget or a silent skip.
- Publication-time verification stays blocking but becomes confirm-only: it re-checks (repair edits between `done` and publication can introduce new mutants) and is no longer where problems are first discovered. Rules out removing the publication gate.
- Reuse the existing diff-derived verifier and its seams unchanged; only the call site (lifecycle point) and the reprompt wiring are new. Rules out a second verifier implementation.

## Acceptance criteria

- [ ] A write-loop test proves a surviving mutation at `done` triggers a reprompt naming the mutation + source site, and that a subsequent iteration adding a killing test completes the run (no publication-time strand); it fails against the pre-fix loop that only verifies at publication.
- [ ] A test proves publication-time verification still blocks on a mutation introduced *after* the in-loop pass (repair-introduced mutant), settling the existing `surviving_mutation_failed`.
- [ ] A test proves the in-loop reprompt honors the `// mutation-equivalent: <reason>` directive (accepts that exact site+mutation, does not reprompt) once [[mutation-gate-equivalent-mutation-escape-hatch]] lands, and that reprompt-budget exhaustion settles as today.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the implement loop verifies diff-derived mutations at `done` and reprompts on a survivor; publication verification is confirm-only.
- `v2/docs/workflow-runner.md` — completion-verification ordering: in-loop discovery before review/publication, publication re-check after.
- `v2/docs/operator-runbook.md` — recovery: mutation misses now reprompt the live agent rather than stranding post-publication; a publication-time survivor is a repair-introduced mutant.

## Sequencing

Depends on [[mutation-gate-equivalent-mutation-escape-hatch]] (the reprompt names the equivalence directive as a remedy). Highest-leverage of the mutation-gate P0 group — it removes the operator from the strand-and-hand-finish loop.
