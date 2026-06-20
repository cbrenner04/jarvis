# Shared spec/blocker parser

## Problem

Spec parsing is split across modes: `parsePatchSpec` + types live in `v1/src/modes/patch/spec.ts`; `## Blocker` detection is duplicated — once inside `parsePatchSpec` (`blocker: string | undefined`) and again in `v1/src/modes/plan/blocker.ts` (`detectBlocker` returning `{ hasBlocker, body? }`). `v1/src/modes/patch/blocker.ts` is a dead thin wrapper (no non-test importer). Two heading scanners can drift on `## Acceptance criteria` / `## Blocker` variants.

Consolidate into one `shared/` module owning index/checklist traversal, `## Acceptance criteria` extraction, and `## Blocker` detection. Patch and plan import it; triage reaches it transitively via `snapshotAcceptanceCriteria`.

## Decisions

- Module lives under `shared/` (co-located `*.test.ts`), since `shared/**` must not import `v1/**`/`v2/**` and both modes consume it.
- One blocker-extraction path backs both `parseSpec(...).blocker` and the standalone `detectBlocker`. Rules out two scanners inside the shared module — the drift this consolidates.
- Preserve both pre-existing blocker shapes verbatim: `parseSpec(...).blocker` is `string | undefined` (omitted when body empty); `detectBlocker` returns `{ hasBlocker, body? }` with `hasBlocker` true even on empty body. Rules out "fixing" the empty-body discrepancy and silently shifting plan's gate semantics.
- Duplicate-section selection unifies on **first** exact `## Blocker` / `## Acceptance criteria` (both consumers). The two pre-existing scanners diverge here — `parsePatchSpec` keeps the last match, `detectBlocker` takes the first; the shared helper must pick one. First-occurrence matches `detectBlocker` (plan's gate, unchanged) and v1-behaviors flags patch's last-wins as undocumented `[uncertain]` (line 334). Rules out carrying two selection rules through the shared helper or silently keeping patch's last-wins. Single-section behavior (the only documented/tested case) is unchanged; only patch's previously-undocumented duplicate handling flips.
- The shared extraction helper does body extraction only. Near-miss `## Acceptance criteria` / `## Blocker` heading warnings stay a `parseSpec` concern; `detectBlocker` emits no warnings. Rules out hoisting warning emission into the shared path and leaking parser warnings into plan's gate.
- Rename `parsePatchSpec` → `parseSpec`. The shared parser is mode-agnostic (plan/triage use it too); the `patch` label no longer fits. Rules out a patch-flavored name on a generic shared parser.
- Legacy review-gate classification (`isLegacyReviewGateBlocker`, `hasGenuineBlocker`) is plan policy, not generic parsing — it does **not** move to `shared/`. Relocate it to a new plan-mode module `v1/src/modes/plan/review-gate.ts` imported by its only call sites (`draft.ts`, `review.ts`); delete `plan/blocker.ts`. Rules out leaking plan-historical logic into the shared parser, and removes implementer guesswork on the destination.
- Shared spec types (`AcceptanceCriterion` et al.) re-export from `patch/subspec.ts` so `shrink.test.ts`'s existing `AcceptanceCriterion` import chain stays green. Rules out repointing that test import as collateral scope.
- Delete `patch/blocker.ts` and `plan/blocker.ts` outright; repoint imports directly, no re-export shims.
- Fold `patch/blocker.test.ts` coverage (currently exercising the dead `hasBlocker`/`extractBlockerBody`) into shared parser tests rather than preserve the dead API.

## Task checklist

- [ ] Create shared parser module: `parseSpec`, `ParsedSpec`/`TaskItem`/`LinkedSubspec`/`AcceptanceCriterion` types, `detectBlocker`, sharing one blocker-extraction helper.
- [ ] Repoint patch call sites (`subspec.ts`, `completion.ts`, `pr.ts`, `shrink.ts`, `run.ts`) to the shared module; have `subspec.ts` re-export the shared spec types; delete `patch/spec.ts` and `patch/blocker.ts`.
- [ ] Repoint plan call sites (`draft.ts`, `review.ts`) to shared `detectBlocker`; move the legacy review-gate helpers to `v1/src/modes/plan/review-gate.ts`; delete `plan/blocker.ts`.
- [ ] Migrate `patch/spec.test.ts` (imports `parsePatchSpec` directly) into the co-located shared parser suite; fold in the dead-API `patch/blocker.test.ts` coverage.
- [ ] Shared parser tests cover index checklist + linked-subspec parsing, acceptance criteria, blocker cases, and duplicate-section first-occurrence selection for both consumers.
- [ ] Update `v2/docs/v1-behaviors.md`: repoint the `patch/spec.ts` Sources citations (lines 308, 313, 314, 334) and the `patch/blocker.ts` citation (line 314) to the shared module, and resolve the line-334 `[uncertain]` entry by documenting first-occurrence selection for duplicate `## Acceptance criteria` / `## Blocker`.

## Acceptance criteria

- [ ] A single module under `shared/` is the only definition of `parseSpec` (formerly `parsePatchSpec`), index/checklist + linked-subspec parsing, `## Acceptance criteria` extraction, and `## Blocker` detection; patch and plan import it.
- [ ] `v1/src/modes/patch/spec.ts`, `v1/src/modes/patch/blocker.ts`, and `v1/src/modes/plan/blocker.ts` no longer exist, and no re-export shim replaces them.
- [ ] Patch behavior is unchanged: a missing/near-miss `## Acceptance criteria` heading still surfaces parser warnings, and an exact `## Blocker` body still drives blocked exit `7`.
- [ ] Plan behavior is unchanged: a genuine `## Blocker` still gates draft/review, while the legacy review-gate body is still classified as non-genuine.
- [ ] When a document has more than one exact `## Blocker` (or `## Acceptance criteria`), both consumers select the first occurrence; a shared-suite test pins this for `parseSpec` and `detectBlocker`.
- [ ] `detectBlocker` emits no warnings; near-miss heading warnings appear only on `parseSpec`.
- [ ] Shared module tests prove: index checklist + linked-subspec parsing, `## Acceptance criteria` extraction with near-miss heading warnings, and `## Blocker` detection (exact heading, case-sensitive) — including that empty-body blockers yield `detectBlocker.hasBlocker === true` but `parseSpec(...).blocker === undefined`.
- [ ] `v2/docs/v1-behaviors.md` spec/blocker/acceptance Sources lines (308, 313, 314, 334) point at the shared module rather than the deleted per-mode files, and the line-334 `[uncertain]` entry is resolved to document first-occurrence duplicate-section selection.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: centralized spec parsing ownership. Repoint the `v1/src/modes/patch/spec.ts` Sources citations (lines 308, 313, 314, 334) and the `v1/src/modes/patch/blocker.ts` citation (line 314) at the shared module. `plan/blocker.ts` is not cited in this file. Resolve the line-334 `[uncertain]` entry: duplicate `## Acceptance criteria` / `## Blocker` sections now deterministically select the first occurrence.
