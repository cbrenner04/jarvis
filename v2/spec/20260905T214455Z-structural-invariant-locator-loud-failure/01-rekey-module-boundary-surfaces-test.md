# Re-key shared/module-boundary-surfaces.test.ts

## Problem

Rows `shr-mbs-surfaces-registry`, `shr-mbs-split-emitted-files`, `shr-mbs-split-index-links`, `shr-mbs-split-section-bullets`, `shr-mbs-manifest-union`, and `shr-mbs-k4-cli-first-filename` in `v2/docs/structural-invariant-test-audit.md` pin split and registry invariants to duplicated literals, manifest child filename lists, and positional filename pins that pass vacuously when normalization output moves.

## Decision ledger

- `shr-mbs-surfaces-registry` asserts against the imported `MODULE_BOUNDARY_SURFACES` export only, not a duplicated literal array; rules out hardcoded `["persistence", "daemon", "cli", "execution-loop"]` beside the import.
- Split-tree rows derive expected child filenames and preserved section bullets from `normalizePlanDraftSpecDir` / `referencedArtifactPaths` outputs on the staged fixture, not from `fixtures/module-boundary-surfaces/manifest.json` `expectedChildren.file` lists; rules out manifest file-list equality as the source of truth.
- `shr-mbs-k4-cli-first-filename` derives first emitted surface file from `orderModuleBoundariesForSplit` over the fixture draft body, not `emittedFiles[0] === "00-cli.md"`; rules out positional filename pins.
- Markdown section extraction in this file routes through shared loud-failure locators; rules out local helpers that return `[]` or `""` when a heading is absent.

## Task checklist

- [ ] Re-key audit rows `shr-mbs-surfaces-registry`, `shr-mbs-split-emitted-files`, `shr-mbs-split-index-links`, `shr-mbs-split-section-bullets`, `shr-mbs-manifest-union`, and `shr-mbs-k4-cli-first-filename` per the decision ledger.
- [ ] Replace local section-slicing helpers with imports from `shared/structural-test-locator.ts` where they slice fixture or emitted markdown.

## Acceptance criteria

- [x] `shared/module-boundary-surfaces.test.ts` test `classifies committed phrases` asserts registry membership via the imported `MODULE_BOUNDARY_SURFACES` export without a duplicated literal expected array; it fails against the pre-fix hardcoded literal and passes after re-key.
- [x] `shared/module-boundary-surfaces.test.ts` staged-tree normalization cases derive expected child filenames from normalization output rather than manifest `expectedChildren.file` lists; they fail against the pre-fix manifest list pins and pass after re-key.
- [x] `shared/module-boundary-surfaces.test.ts` case `module boundary surfaces > inverting draft dependency order guard fails k4` derives the first emitted surface file from split ordering, not a hardcoded filename pin; it fails against the pre-fix `emittedFiles[0] === "00-cli.md"` pin and passes after re-key.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
