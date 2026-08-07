---
name: mutation-checkpoint-descriptive-selection-and-ambiguous-basename
---

# Mutation-checkpoint verifier: shape-based criterion selection and ambiguous-basename disambiguation

Splitting does not apply: descriptive-criteria selection and ambiguous-basename pinning resolution both land on the execution-loop mutation-checkpoint verifier seam (shared selector + verifier resolution).

## Problem

Two verifier behaviors combine to hard-block (`contract_miss`, `unresolved_pinning_test`, `resumable:false`) specs *about* mutation-checkpoint authoring even when implementation is correct.

1. **Ambiguous basename → `unresolved_pinning_test`.** A criterion references its pinning file by bare basename (`` `write.test.ts` ``). Two files share that basename (`v2/src/execution/write.test.ts`, `v2/src/commands/write.test.ts`), so pinning resolution cannot disambiguate. Extension tolerance does not cover same-basename-different-dir collisions.
2. **Descriptive criteria over-matched as checkpoints.** `selectMutationCheckpointCriteria` treats any AC block containing `Mutation checkpoint:` / `Keystone checkpoint:` substrings as a checkpoint. Functional AC that documents those tokens as feature content is gated through pinning resolution it was never meant to satisfy.

## Decisions

- Bare-basename pinning resolution prefers the candidate under the run's touched surface when multiple on-disk files share the basename — rules out always refusing `unresolved_pinning_test` on same-basename-different-dir collisions that extension tolerance cannot resolve.
- When touched-surface preference cannot pick exactly one candidate, refuse with a distinct ambiguous-basename diagnostic naming every candidate path — rules out generic `unresolved_pinning_test` without candidate enumeration; rules out silent guessing among equals.
- Path-qualified pinning references (`v2/src/execution/write.test.ts`) continue to resolve without basename search — rules out basename fallback when the criterion already names a path separator.
- Guard checkpoint selection requires a leading `Mutation checkpoint:` prefix on the assembled criterion block or a directive-shaped `// @mutate` occurrence — rules out substring `includes("Mutation checkpoint:")` that selects functional AC describing checkpoint tooling.
- Keystone checkpoint selection requires a leading `Keystone checkpoint:` prefix on the assembled criterion block — rules out descriptive prose mentioning keystone markers in functional AC; `@mutate` in the block links the pin only.
- Genuine ticked guard and keystone checkpoints retain the existing apply/verify/refuse contract — rules out weakening real checkpoint gating while narrowing false positives.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — a regression drives bare-basename pinning when `write.test.ts` exists under both `v2/src/execution/` and `v2/src/commands/` and touched-surface context picks the execution copy (reaches `caught`, not `unresolved_pinning_test`); when no touched-surface candidate applies, the report names all candidate paths under a distinct ambiguous-basename reason (not generic `unresolved_pinning_test`); fails against pre-fix behavior.
- [ ] `write.test.ts` — a regression embeds a subspec whose functional AC mention `@mutate`, `Mutation checkpoint:`, `Keystone checkpoint:`, and `` `write.test.ts` `` only as descriptive prose (no checkpoint prefix, no real `// @mutate` directive) and asserts implement completion does not settle `contract_miss` for mutation-checkpoint parsing; fails pre-fix.
- [ ] Mutation checkpoint: in the descriptive-criteria regression, a `// @mutate` directive inverting the criterion-selection shape guard turns that regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — path-qualify pinning references when the basename is ambiguous; the verifier no longer flags descriptive criteria that mention checkpoint tokens without checkpoint shape.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning file by repo-relative path when its basename is not unique; functional AC may mention checkpoint tokens descriptively without selecting.

## Prerequisites

- `selectMutationCheckpointCriteria` and `selectKeystoneCheckpointCriteria` select ticked non-human-only criteria from assembled bullet blocks.
- Bare `@mutate` prose without directive shape does not select a guard checkpoint.
- Pinning-test resolution accepts path-qualified references or a unique bare basename; extension tolerance applies when the primary basename matches zero files and exactly one alternate matches across `.test.ts`/`.test.tsx`/`.test.js`/`.test.jsx`.
- `verifyMutationCheckpoints` applies linked directives, runs classified scoped suites, and surfaces pinning-resolution failures at the `spec.criteria-ticked` completion boundary.
