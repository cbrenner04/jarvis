# 00 - Keep the authored draft intact

## Problem

`normalizePlanDraftSpecDir` (`shared/module-boundary-surfaces.ts:417`) re-splits the plan agent's authored draft into one subspec per module-boundary surface, copying the parent body into each child and replacing only the bullets under three headings. The children therefore share a byte-identical `## Problem`, are titled with bare surface names (`# Persistence`, `# CLI`), can carry zero acceptance criteria when a boundary receives no bullets, and are renumbered by `emittedIndex` without reconciling `index.md` or in-body titles.

Classification is regex keyword matching over criterion prose including file paths, so a criterion naming `v2/src/daemon/…` pulls a draft into a daemon split. The surfaces are jarvis's own architecture but the function runs for every registered project, so ordinary product vocabulary ("persists across relaunch", "a feature flag") splits a draft in a repo that has no such layers.

## Decision ledger

- Retire the split: `normalizePlanDraftSpecDir` keeps the authored `NN-*.md` files as authored, emitting no additional subspecs and rewriting no titles or bodies; rules out deriving per-surface framing, which a post-hoc splitter cannot synthesize from whole-change prose.
- Retire the surface taxonomy and its classification helpers rather than making them per-project configurable; rules out a configurable taxonomy, since no consumer outside this module reads it and the invariant worth enforcing is artifact count, not layer identity.
- Keep `assertIndexLinks` running on every draft, unchanged; rules out losing orphan and duplicate-link detection along with the split.
- Keep the existing behaviour when a draft declares a single surface; that path already returned without splitting, so its observable outcome is unchanged; rules out treating this as a behaviour change for already-passing drafts.

## Task checklist

- [ ] Remove per-surface child emission from `normalizePlanDraftSpecDir`, retaining index-link validation.
- [ ] Remove `MODULE_BOUNDARY_SURFACES`, `SURFACES`, `classifyModuleBoundaryText`, `moduleBoundariesForAcceptanceCriteria`, `spansMultipleModuleBoundaries` and the split-only helpers they feed, along with their tests.
- [ ] Leave `v2/src/execution/write.ts`'s call site in place so index validation still runs.

## Acceptance criteria

- [ ] `shared/module-boundary-surfaces.test.ts` proves a draft whose acceptance criteria mention two jarvis surfaces (for example one naming `v2/src/daemon/…` and one naming `state-store`) retains exactly its authored files, with each file's title and `## Problem` byte-identical to the input; it fails against the pre-fix split reachable on main.
- [ ] `shared/module-boundary-surfaces.test.ts` proves a draft written in product vocabulary — one criterion containing "persists across relaunch" and one containing "a feature flag" — is neither split nor rejected; it fails against the pre-fix classifier.
- [ ] `shared/module-boundary-surfaces.test.ts` proves a draft with a subspec carrying no acceptance criteria is left as authored rather than being emitted or renumbered.
- [ ] A guard test proves no production module outside `shared/module-boundary-surfaces.ts` imports a surface-classification export.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — the plan write path validates the authored draft and no longer re-splits it.
