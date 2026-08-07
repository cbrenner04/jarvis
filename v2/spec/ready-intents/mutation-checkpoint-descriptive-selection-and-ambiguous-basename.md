---
name: mutation-checkpoint-descriptive-selection-and-ambiguous-basename
---

# Mutation-checkpoint verifier: shape-based criterion selection and ambiguous-basename disambiguation

Splitting does not apply: descriptive-criteria selection and ambiguous-basename pinning resolution both land on the execution-loop mutation-checkpoint verifier seam (shared selector + verifier resolution).

## Problem

Two verifier behaviors combine to hard-block (`contract_miss`, `unresolved_pinning_test`, `resumable:false`) specs *about* mutation-checkpoint authoring even when implementation is correct.

1. **Ambiguous basename → `unresolved_pinning_test`.** A criterion references its pinning file by bare basename (`` `write.test.ts` ``). Two files share that basename (`v2/src/execution/write.test.ts`, `v2/src/commands/write.test.ts`), so pinning resolution cannot disambiguate. Extension tolerance does not cover same-basename-different-dir collisions.
2. **Descriptive criteria over-matched as checkpoints.** `selectMutationCheckpointCriteria` treats any AC block containing `Mutation checkpoint:` / `Keystone checkpoint:` / `@mutate` substrings as a checkpoint. Functional AC that documents those tokens as feature content is gated through pinning resolution it was never meant to satisfy.

## Decisions

- Bare-basename pinning resolution prefers the candidate whose parent directory overlaps the run's changed paths when multiple on-disk files share the basename — rules out always refusing `unresolved_pinning_test` on same-basename-different-dir collisions that extension tolerance cannot resolve.
- Changed paths for disambiguation are repo-relative `git diff --name-only <worktree.baseRef>` (same source as CI test scope); a candidate matches when its parent directory equals the parent directory of at least one changed path — rules out v1/v2/shared bucket heuristics that cannot separate `execution/` from `commands/`.
- `verifyMutationCheckpoints` accepts optional `changedPaths` on `MutationCheckpointSeams`; write-loop and implement completion thread the baseRef diff into `resolvePinningTestPath` — rules out basename disambiguation that cannot see what the run actually touched.
- When changed-path overlap cannot pick exactly one candidate, refuse with `ambiguous_pinning_basename` on `report.unparseable`, listing every candidate repo-relative path in `describeUnparseable` — rules out generic `unresolved_pinning_test` without candidate enumeration; rules out silent guessing among equals.
- Path-qualified pinning references (`v2/src/execution/write.test.ts`) continue to resolve without basename search — rules out basename fallback when the criterion already names a path separator.
- Guard checkpoint selection requires the canonical suffix `` `pinFile` — `pinTitle`; Mutation checkpoint:`` on the assembled criterion block (authoring contract per spec-guidance and `subspecNaming`) or a directive-shaped `// @mutate` occurrence — rules out substring `includes("Mutation checkpoint:")` / `includes("@mutate")` that selects functional AC describing checkpoint tooling.
- Keystone checkpoint selection requires the canonical suffix `` `pinFile` — `pinTitle`; Keystone checkpoint:`` on the assembled criterion block — rules out descriptive prose mentioning keystone markers in functional AC; `@mutate` in the block links the pin only.
- Genuine ticked guard and keystone checkpoints retain the existing apply/verify/refuse contract — rules out weakening real checkpoint gating while narrowing false positives.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — a regression drives bare-basename pinning when `write.test.ts` exists under both `v2/src/execution/` and `v2/src/commands/` and `changedPaths` containing only execution-side edits picks the execution copy (reaches `caught`, not `unresolved_pinning_test`); when no changed path shares a candidate parent directory, `describeUnparseable` reports `reason: ambiguous_pinning_basename` with every candidate path enumerated; fails against pre-fix behavior.
- [ ] `write.test.ts` — a regression embeds a subspec whose functional AC mention `@mutate`, `Mutation checkpoint:`, `Keystone checkpoint:`, and `` `write.test.ts` `` only as descriptive prose (no canonical checkpoint suffix, no real `// @mutate` directive) and asserts implement completion does not settle `contract_miss` for mutation-checkpoint parsing; fails pre-fix.
- [ ] `write.test.ts` — descriptive-criteria regression pin; Mutation checkpoint: its pinning test carries `// @mutate` inverting the criterion-selection shape guard in `shared/mutation-checkpoint-criteria.ts`; the mutation turns the AC-2 regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — path-qualify pinning references when the basename is ambiguous; bare-basename ties break on changed-path directory overlap; `ambiguous_pinning_basename` lists candidates; the verifier no longer flags descriptive criteria that mention checkpoint tokens without canonical checkpoint shape.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning file by repo-relative path when its basename is not unique; functional AC may mention checkpoint tokens descriptively without selecting; canonical `` `file` — `title`; Mutation checkpoint:`` / `` `file` — `title`; Keystone checkpoint:`` suffix remains the authoring contract.

## Prerequisites

- `selectMutationCheckpointCriteria` and `selectKeystoneCheckpointCriteria` select ticked non-human-only criteria from assembled bullet blocks.
- Bare `@mutate` prose without directive shape does not select a guard checkpoint.
- Pinning-test resolution accepts path-qualified references or a unique bare basename; extension tolerance applies when the primary basename matches zero files and exactly one alternate matches across `.test.ts`/`.test.tsx`/`.test.js`/`.test.jsx`.
- `verifyMutationCheckpoints` applies linked directives, runs classified scoped suites, and surfaces pinning-resolution failures at the `spec.criteria-ticked` completion boundary; it does not yet accept changed-path context for basename disambiguation.
