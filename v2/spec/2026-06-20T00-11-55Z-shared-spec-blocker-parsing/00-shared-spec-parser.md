# Shared spec/blocker parser

## Problem

Spec parsing is split across modes: `parsePatchSpec` + types live in `v1/src/modes/patch/spec.ts`; `## Blocker` detection is duplicated — once inside `parsePatchSpec` (`blocker: string | undefined`) and again in `v1/src/modes/plan/blocker.ts` (`detectBlocker` returning `{ hasBlocker, body? }`). `v1/src/modes/patch/blocker.ts` is a dead thin wrapper (no non-test importer). Two heading scanners can drift on `## Acceptance criteria` / `## Blocker` variants.

Consolidate into one `shared/` module owning index/checklist traversal, `## Acceptance criteria` extraction, and `## Blocker` detection. Patch and plan import it; triage reaches it transitively via `snapshotAcceptanceCriteria`.

## Decisions

- Module lives under `shared/` (co-located `*.test.ts`), since `shared/**` must not import `v1/**`/`v2/**` and both modes consume it.
- One blocker-extraction path backs both `parseSpec(...).blocker` and the standalone `detectBlocker`. Rules out two scanners inside the shared module — the drift this consolidates.
- Preserve both pre-existing blocker shapes verbatim: `parseSpec(...).blocker` is `string | undefined` (omitted when body empty); `detectBlocker` returns `{ hasBlocker, body? }` with `hasBlocker` true even on empty body. Rules out "fixing" the empty-body discrepancy and silently shifting plan's gate semantics.
- Rename `parsePatchSpec` → `parseSpec`. The shared parser is mode-agnostic (plan/triage use it too); the `patch` label no longer fits. Rules out a patch-flavored name on a generic shared parser.
- Legacy review-gate classification (`isLegacyReviewGateBlocker`, `hasGenuineBlocker`) is plan policy, not generic parsing — it does **not** move to `shared/`. Relocate it to a plan-mode home and delete `plan/blocker.ts`. Rules out leaking plan-historical logic into the shared parser.
- Delete `patch/blocker.ts` and `plan/blocker.ts` outright; repoint imports directly, no re-export shims.
- Fold `patch/blocker.test.ts` coverage (currently exercising the dead `hasBlocker`/`extractBlockerBody`) into shared parser tests rather than preserve the dead API.

## Task checklist

- [ ] Create shared parser module: `parseSpec`, `ParsedSpec`/`TaskItem`/`LinkedSubspec`/`AcceptanceCriterion` types, `detectBlocker`, sharing one blocker-extraction helper.
- [ ] Repoint patch call sites (`subspec.ts`, `completion.ts`, `pr.ts`, `shrink.ts`, `run.ts`) to the shared module; delete `patch/spec.ts` and `patch/blocker.ts`.
- [ ] Repoint plan call sites (`draft.ts`, `review.ts`) to shared `detectBlocker`; relocate the legacy review-gate helpers; delete `plan/blocker.ts`.
- [ ] Migrate/fold tests into co-located shared parser tests covering index checklist, acceptance criteria, and blocker cases.
- [ ] Update `v2/docs/v1-behaviors.md` Sources lines to point at the shared module.

## Acceptance criteria

- [ ] A single module under `shared/` is the only definition of `parseSpec` (formerly `parsePatchSpec`), index/checklist + linked-subspec parsing, `## Acceptance criteria` extraction, and `## Blocker` detection; patch and plan import it.
- [ ] `v1/src/modes/patch/spec.ts`, `v1/src/modes/patch/blocker.ts`, and `v1/src/modes/plan/blocker.ts` no longer exist, and no re-export shim replaces them.
- [ ] Patch behavior is unchanged: a missing/near-miss `## Acceptance criteria` heading still surfaces parser warnings, and an exact `## Blocker` body still drives blocked exit `7`.
- [ ] Plan behavior is unchanged: a genuine `## Blocker` still gates draft/review, while the legacy review-gate body is still classified as non-genuine.
- [ ] Shared module tests prove: index checklist + linked-subspec parsing, `## Acceptance criteria` extraction with near-miss heading warnings, and `## Blocker` detection (exact heading, case-sensitive) — including that empty-body blockers yield `detectBlocker.hasBlocker === true` but `parseSpec(...).blocker === undefined`.
- [ ] `v2/docs/v1-behaviors.md` Sources references for spec/blocker/acceptance parsing point at the shared module rather than the deleted per-mode files.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: centralized spec parsing ownership; update the Sources lines that currently cite `v1/src/modes/patch/spec.ts`, `v1/src/modes/patch/blocker.ts`, and `v1/src/modes/plan/blocker.ts`.
