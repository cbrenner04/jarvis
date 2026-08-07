# Ambiguous-basename disambiguation

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

A criterion names its pinning file by bare basename (`` `write.test.ts` ``) while `v2/src/execution/write.test.ts` and `v2/src/commands/write.test.ts` both exist; extension tolerance cannot separate same-basename-different-dir collisions and resolution refuses with `unresolved_pinning_test`.

## Decision ledger

- Bare-basename pinning resolution prefers the candidate whose parent directory equals the parent directory of at least one repo-relative changed path when multiple on-disk files share the basename — rules out always refusing `unresolved_pinning_test` on same-basename-different-dir collisions extension tolerance cannot resolve.
- Changed paths for disambiguation are repo-relative `git diff --name-only <worktree.baseRef>` (same source as CI test scope) — rules out v1/v2/shared bucket heuristics that cannot separate `execution/` from `commands/`.
- Parent-directory equality filtering applies to the final candidate set after extension tolerance, not only primary basename hits — rules out disambiguation that ignores extension-tolerant resolution results.
- Nested edits under a pinning test's parent directory satisfy parent-directory overlap; spec-only or docs-only diffs with no overlapping parent dirs must path-qualify the pinning reference or ensure a changed path shares the candidate parent directory; untracked paths are excluded from `git diff --name-only <baseRef>` (consistent with CI test-scope source).
- `verifyMutationCheckpoints` accepts optional `changedPaths` on `MutationCheckpointSeams`; implement completion and write-loop reprompt paths thread the baseRef diff into `resolvePinningTestPath` — rules out basename disambiguation that cannot see what the run actually touched.
- When changed-path parent overlap cannot pick exactly one candidate, refuse with `ambiguous_pinning_basename` on `report.unparseable` — rules out generic `unresolved_pinning_test` without candidate enumeration; rules out silent guessing among equals.
- `ambiguous_pinning_basename` unparseable contract: extend `UnparseableDirective.reason` with `ambiguous_pinning_basename`; populate `criterionText` and `rawReference` like `unresolved_pinning_test`; add `candidates: string[]` (every repo-relative path that matched the bare basename); `describeUnparseable` emits `criterion: …; reference: …; reason: ambiguous_pinning_basename; candidates: <comma-separated repo-relative paths>`.
- Path-qualified pinning references (`v2/src/execution/write.test.ts`) continue to resolve without basename search — rules out basename fallback when the criterion already names a path separator.
- `ambiguous_pinning_basename` blocks completion the same way as `unresolved_pinning_test` at the `spec.criteria-ticked` boundary in both `checkMutationCheckpointsAtCompletion` (`write.ts`) and `blockingUnparseableEntries` (`write-loop.ts`) — rules out reprompt eligibility or silent pass on basename ties.

## Prerequisites

- Pinning-test resolution accepts path-qualified references or a unique bare basename; extension tolerance applies when the primary basename matches zero files and exactly one alternate matches across `.test.ts`/`.test.tsx`/`.test.js`/`.test.jsx` (`resolvePinningTestPath` in `mutation-checkpoint-verifier.ts`).
- `verifyMutationCheckpoints` applies linked directives, runs classified scoped suites, and surfaces pinning-resolution failures at the `spec.criteria-ticked` completion boundary; it does not yet accept changed-path context for basename disambiguation.

## Tasks

- Extend `UnparseableDirective.reason` with `ambiguous_pinning_basename` and `candidates?: string[]`; extend `describeUnparseable` per the contract above.
- Extend `resolvePinningTestPath` to accept optional `changedPaths`; when bare basename matches multiple files, keep candidates whose parent directory equals the parent directory of at least one changed path (after extension tolerance); resolve when exactly one remains; otherwise emit `ambiguous_pinning_basename` with full candidate list.
- Add optional `changedPaths` to `MutationCheckpointSeams`; thread repo-relative `git diff --name-only <baseRef>` from `checkMutationCheckpointsAtCompletion` in `write.ts` and the write-loop reprompt `verifyMutationCheckpoints` call.
- Treat `ambiguous_pinning_basename` as blocking unparseable alongside `unresolved_pinning_test` in `checkMutationCheckpointsAtCompletion` (`write.ts`) and `blockingUnparseableEntries` (`write-loop.ts`).
- Add `mutation-checkpoint-verifier.test.ts` regressions for changed-path basename disambiguation and `ambiguous_pinning_basename` candidate enumeration; update `write.test.ts` — `ambiguous pinning-test basename blocks completion` to expect `ambiguous_pinning_basename` instead of `unresolved_pinning_test`.
- Add `write.test.ts` integration regression proving execution-vs-commands `write.test.ts` collision disambiguated via the real implement completion path (execution-only diff → `caught`, not manual `changedPaths` seam injection).
- Update `v2/docs/operator-runbook.md` § Gate trust, `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria, and `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet per documentation updates below.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `mutation-checkpoint-verifier.test.ts` — `bare basename disambiguates via changed-path parent directory` proves bare-basename pinning when `write.test.ts` exists under both `v2/src/execution/` and `v2/src/commands/` and `changedPaths` containing only execution-side edits picks the execution copy (reaches `caught`, not `unresolved_pinning_test`); when no changed path shares a candidate parent directory, `describeUnparseable` reports `reason: ambiguous_pinning_basename` with `candidates:` listing every candidate path enumerated; fails against pre-fix behavior (reachable on `write.test.ts` — `ambiguous pinning-test basename blocks completion`, which today expects `unresolved_pinning_test`).
- [x] `mutation-checkpoint-verifier.test.ts` — `bare basename disambiguates via changed-path parent directory`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` inverting changed-path parent-directory overlap in `resolvePinningTestPath` using a uniquely occurring anchor in landed code; the mutation turns the named pin RED.
- [x] `write.test.ts` — `bare basename disambiguates via completion changed paths` proves execution-vs-commands `write.test.ts` collision resolved through the real implement completion path when only execution-side files differ from base (reaches mutation checkpoint `caught`, not `unresolved_pinning_test` or `ambiguous_pinning_basename`); fails pre-fix.
- [x] `write.test.ts` — `ambiguous pinning-test basename blocks completion` expects `reason: ambiguous_pinning_basename` with candidate enumeration instead of `unresolved_pinning_test`; fails pre-fix.
- [x] `v2/docs/operator-runbook.md` § Gate trust documents path-qualifying pinning references when the basename is ambiguous, bare-basename ties breaking on changed-path directory overlap, and `ambiguous_pinning_basename` candidate listing.
- [x] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents repo-relative pinning paths when basename is not unique and replaces same-basename-different-dir refusal vocabulary from `unresolved_pinning_test` to `ambiguous_pinning_basename` with candidate enumeration.
- [x] `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet records changed-path basename disambiguation and `ambiguous_pinning_basename` refusal.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — path-qualify pinning references when the basename is ambiguous; bare-basename ties break on changed-path directory overlap; `ambiguous_pinning_basename` lists candidates.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning file by repo-relative path when its basename is not unique; same-basename-different-dir collisions refuse `ambiguous_pinning_basename` with candidate enumeration (not `unresolved_pinning_test`).
- `v2/docs/v1-behaviors.md` — implement-write mutation-checkpoint pinning resolution and `ambiguous_pinning_basename` unparseable-reason bullets.
