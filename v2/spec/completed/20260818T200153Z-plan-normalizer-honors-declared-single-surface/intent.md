---
name: plan-normalizer-honors-declared-single-surface
---
# Plan-draft normalizer honors the intent's declared single surface

## Prerequisites

- The plan-draft normalizer splits staged plan drafts by acceptance-criterion module boundary and hard-errors on multi-surface bullets.
- The intent split stage writes a one-line unsplit rationale and a single primary implementation surface into single-surface intents.
- The staged plan directory the normalizer validates contains `intent.md` alongside `index.md` and the numbered subspecs.

## Primary implementation surface

shared/module-boundary-surfaces.ts

Unsplit rationale: Reading the declaration, suppressing the split, and the producing prompt's grammar all sit on the plan-draft normalization path in the execution loop, so splitting does not apply.

## Problem

- `normalizePlanDraftSpecDir` re-derives surface scope by keyword regex over `## Acceptance criteria` bullets and ignores the scope the intent split stage already declared, so a spec that merely names another surface as an unchanged dependency classifies across two surfaces, gets split, and hard-errors on the first bullet matching both.
- Observed on `pipeline-list-human-readable` (2026-08-16/17): five consecutive plan runs stranded with an artifact-contract blocker and the tree had to be hand-landed (PR #2877); a redraft cannot escape, because the vocabulary is correct and the intent's own Decisions re-introduce it.

## Decisions

- When the staged `intent.md` declares a single surface, the normalizer skips module-boundary splitting, the multi-surface bullet hard-error, and the out-of-union bullet checks for that plan; keyword classification is not consulted. Rules out re-deriving scope the intent stage already decided and the operator already reviewed.
- The declaration is read only from the staged `intent.md`; text in a subspec body never suppresses the split. Rules out a drafting agent opting its own subspec out with prose.
- The declaration grammar is the pair the split prompt already emits: a non-empty `Unsplit rationale:` line plus a `## Primary implementation surface` section naming exactly one entry. Rules out heuristic parsing of free prose, and rules out inventing a new `## Module-boundary surface` section the producer does not write.
- Tighten `prompts/intent/split.md` to require that exact pair verbatim for single-surface intents, and update the intent-split regression expectations in the same spec, so producer and consumer agree. Rules out a consumer keying on a grammar the prompt only implies.
- Absent `intent.md`, or absent either half of the declaration, behavior is byte-for-byte what it is today. Rules out hard-erroring on legacy, hand-authored, or durable-directory inputs that never declared scope.
- All other normalizer checks still run on a declared plan: index-link validation, keystone-criterion satisfiability, and contiguous renumbering. Rules out a declaration disabling unrelated contract checks.
- Deferred to first consumer: reporting a declaration that disagrees with the keyword-classified union — pin when a diagnostic caller needs it. The skip itself is unconditional either way.

## Acceptance criteria

- [ ] A test in `shared/module-boundary-surfaces.test.ts` fails against the current normalizer and proves a staged plan whose `intent.md` carries the declaration normalizes without error, without splitting, and with subspec and index bytes unchanged, even when its acceptance bullets keyword-classify across two surfaces including one bullet matching both.
- [ ] That test carries a `// @mutate` directive inverting the declaration check in `shared/module-boundary-surfaces.ts` and fails when applied.
- [ ] A test proves the same staged plan with `intent.md` absent, and with each half of the declaration missing, splits or hard-errors exactly as today.
- [ ] A test proves the declaration text placed only in a subspec body, not in `intent.md`, does not suppress the split.
- [ ] A test proves a declared plan still hard-errors on an unlinked index entry and on an unsatisfiable keystone criterion.
- [ ] `prompts/intent/split.md` requires the verbatim declaration pair for single-surface intents, and `v2/src/execution/intent-split-regression.test.ts` asserts it.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft normalizer: a declared single-surface intent bypasses module-boundary splitting; keyword classification applies only to undeclared plans.
- `v1/docs/spec-guidance.md` — the intent's unsplit-rationale and primary-implementation-surface declaration is load-bearing downstream, not review prose.
- `v2/docs/v1-behaviors.md` — align the plan-draft normalizer entry.

## Notes

- Sibling in flight `clear-plan-draft-harness-blocker-before-redraft` handles the stale-blocker aftermath of the same failure; land this off its merged result where they touch the same diagnostics.
- This intent's own plan must keep every `## Decisions`, `## Documentation updates`, and `## Acceptance criteria` bullet within one surface's vocabulary, or it strands on the very defect it removes.
