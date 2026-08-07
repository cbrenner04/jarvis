# Shape-based selection and basename disambiguation

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Two verifier behaviors hard-block (`contract_miss`, `unresolved_pinning_test`, `resumable:false`) specs about mutation-checkpoint authoring when implementation is correct.

1. **Ambiguous basename → `unresolved_pinning_test`.** A criterion names its pinning file by bare basename (`` `write.test.ts` ``) while `v2/src/execution/write.test.ts` and `v2/src/commands/write.test.ts` both exist; extension tolerance cannot separate same-basename-different-dir collisions.
2. **Descriptive criteria over-matched as checkpoints.** `selectMutationCheckpointCriteria` selects any assembled AC block containing `Mutation checkpoint:` / `Keystone checkpoint:` / `@mutate` substrings, so functional AC that documents those tokens as feature content is gated through pinning resolution it was never meant to satisfy.

## Decision ledger

- Bare-basename pinning resolution prefers the candidate whose parent directory equals the parent directory of at least one repo-relative changed path when multiple on-disk files share the basename — rules out always refusing `unresolved_pinning_test` on same-basename-different-dir collisions extension tolerance cannot resolve.
- Changed paths for disambiguation are repo-relative `git diff --name-only <worktree.baseRef>` (same source as CI test scope) — rules out v1/v2/shared bucket heuristics that cannot separate `execution/` from `commands/`.
- `verifyMutationCheckpoints` accepts optional `changedPaths` on `MutationCheckpointSeams`; implement completion and write-loop reprompt paths thread the baseRef diff into `resolvePinningTestPath` — rules out basename disambiguation that cannot see what the run actually touched.
- When changed-path parent overlap cannot pick exactly one candidate, refuse with `ambiguous_pinning_basename` on `report.unparseable`, listing every candidate repo-relative path in `describeUnparseable` — rules out generic `unresolved_pinning_test` without candidate enumeration; rules out silent guessing among equals.
- Path-qualified pinning references (`v2/src/execution/write.test.ts`) continue to resolve without basename search — rules out basename fallback when the criterion already names a path separator.
- Guard checkpoint selection requires the canonical suffix `` `pinFile` — `pinTitle`; Mutation checkpoint:`` on the assembled criterion block (authoring contract per `subspecNaming` in `mutation-checkpoint-verifier.test.ts`) or a directive-shaped `// @mutate` occurrence (`DIRECTIVE_PATTERN`) — rules out substring `includes("Mutation checkpoint:")` / bare `@mutate` prose that selects functional AC describing checkpoint tooling.
- Keystone checkpoint selection requires the canonical suffix `` `pinFile` — `pinTitle`; Keystone checkpoint:`` on the assembled criterion block — rules out descriptive prose mentioning keystone markers in functional AC; `@mutate` in the block links the pin only.
- Genuine ticked guard and keystone checkpoints retain the existing apply/verify/refuse contract — rules out weakening real checkpoint gating while narrowing false positives.
- `ambiguous_pinning_basename` blocks completion the same way as `unresolved_pinning_test` at the `spec.criteria-ticked` boundary — rules out reprompt eligibility or silent pass on basename ties.

## Prerequisites

- `selectMutationCheckpointCriteria` and `selectKeystoneCheckpointCriteria` select ticked non-human-only criteria from assembled bullet blocks (`shared/mutation-checkpoint-criteria.ts`).
- Bare `@mutate` prose without directive shape does not select a guard checkpoint (`mutation-checkpoint-verifier.test.ts` — `prose @mutate without a directive-shaped occurrence is not selected`).
- Pinning-test resolution accepts path-qualified references or a unique bare basename; extension tolerance applies when the primary basename matches zero files and exactly one alternate matches across `.test.ts`/`.test.tsx`/`.test.js`/`.test.jsx` (`resolvePinningTestPath` in `mutation-checkpoint-verifier.ts`).
- `verifyMutationCheckpoints` applies linked directives, runs classified scoped suites, and surfaces pinning-resolution failures at the `spec.criteria-ticked` completion boundary; it does not yet accept changed-path context for basename disambiguation.

## Tasks

- Narrow guard selection in `shared/mutation-checkpoint-criteria.ts` to canonical `` `pinFile` — `pinTitle`; Mutation checkpoint:`` suffix or `DIRECTIVE_PATTERN`; narrow keystone selection to canonical `` `pinFile` — `pinTitle`; Keystone checkpoint:`` suffix only.
- Extend `UnparseableDirective.reason` with `ambiguous_pinning_basename`; extend `describeUnparseable` to enumerate every candidate repo-relative path for that reason.
- Extend `resolvePinningTestPath` to accept optional `changedPaths`; when bare basename matches multiple files, keep candidates whose parent directory equals the parent directory of at least one changed path; resolve when exactly one remains; otherwise emit `ambiguous_pinning_basename` with full candidate list.
- Add optional `changedPaths` to `MutationCheckpointSeams`; thread repo-relative `git diff --name-only <baseRef>` from `checkMutationCheckpointsAtCompletion` in `write.ts` and the write-loop reprompt `verifyMutationCheckpoints` call.
- Treat `ambiguous_pinning_basename` as blocking unparseable alongside `unresolved_pinning_test` in `checkMutationCheckpointsAtCompletion`.
- Add `mutation-checkpoint-verifier.test.ts` regressions for changed-path basename disambiguation and `ambiguous_pinning_basename` candidate enumeration; update `write.test.ts` — `ambiguous pinning-test basename blocks completion` to expect `ambiguous_pinning_basename` instead of `unresolved_pinning_test`.
- Add `write.test.ts` regression proving functional AC that mentions `@mutate`, `Mutation checkpoint:`, `Keystone checkpoint:`, and `` `write.test.ts` `` only as descriptive prose (no canonical checkpoint suffix, no real `// @mutate` directive) completes without `contract_miss` on mutation-checkpoint parsing.
- Update `v2/docs/operator-runbook.md` § Gate trust, `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria, and `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet per documentation updates below.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `bare basename disambiguates via changed-path parent directory` proves bare-basename pinning when `write.test.ts` exists under both `v2/src/execution/` and `v2/src/commands/` and `changedPaths` containing only execution-side edits picks the execution copy (reaches `caught`, not `unresolved_pinning_test`); when no changed path shares a candidate parent directory, `describeUnparseable` reports `reason: ambiguous_pinning_basename` with every candidate path enumerated; fails against pre-fix behavior (reachable on `write.test.ts` — `ambiguous pinning-test basename blocks completion`, which today expects `unresolved_pinning_test`).
- [ ] `write.test.ts` — `functional AC mentioning checkpoint tokens descriptively does not contract_miss` embeds a subspec whose functional AC mention `@mutate`, `Mutation checkpoint:`, `Keystone checkpoint:`, and `` `write.test.ts` `` only as descriptive prose (no canonical checkpoint suffix, no real `// @mutate` directive) and asserts implement completion does not settle `contract_miss` for mutation-checkpoint parsing; fails pre-fix.
- [ ] `mutation-checkpoint-verifier.test.ts` — `bare basename disambiguates via changed-path parent directory`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` inverting changed-path parent-directory overlap in `resolvePinningTestPath` using a uniquely occurring anchor in landed code; the mutation turns the named pin RED.
- [ ] `write.test.ts` — `functional AC mentioning checkpoint tokens descriptively does not contract_miss`; Mutation checkpoint: its pinning test carries `// @mutate shared/mutation-checkpoint-criteria.ts` inverting the criterion-selection shape guard using a uniquely occurring anchor in landed code; the mutation turns the AC-2 regression RED.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents path-qualifying pinning references when the basename is ambiguous, bare-basename ties breaking on changed-path directory overlap, `ambiguous_pinning_basename` candidate listing, and that descriptive criteria mentioning checkpoint tokens without canonical checkpoint shape no longer select.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents repo-relative pinning paths when basename is not unique, descriptive checkpoint-token mentions in functional AC, and that canonical `` `file` — `title`; Mutation checkpoint:`` / `` `file` — `title`; Keystone checkpoint:`` suffix remains the authoring contract.
- [ ] `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet records shape-based guard/keystone selection, changed-path basename disambiguation, and `ambiguous_pinning_basename` refusal.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — path-qualify pinning references when the basename is ambiguous; bare-basename ties break on changed-path directory overlap; `ambiguous_pinning_basename` lists candidates; the verifier no longer flags descriptive criteria that mention checkpoint tokens without canonical checkpoint shape.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning file by repo-relative path when its basename is not unique; functional AC may mention checkpoint tokens descriptively without selecting; canonical `` `file` — `title`; Mutation checkpoint:`` / `` `file` — `title`; Keystone checkpoint:`` suffix remains the authoring contract.
- `v2/docs/v1-behaviors.md` — implement-write mutation-checkpoint selection, pinning resolution, and unparseable-reason bullets.
