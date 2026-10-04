# Remove unreferenced v2 source and fixture files

Delete four files with zero production or test consumers outside their own
pairing: `tui-field-collector.tsx` + co-located test, and two Biome-gate demo
fixtures with zero references. No replacements, stubs, or relocated helpers.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Decisions

- Delete `v2/src/tui/tui-field-collector.tsx` and `tui-field-collector.test.tsx` — rules out stubbing or relocating field collection ahead of a real TUI workflow launcher consumer.
- Delete `v2/test/fixtures/complexity-violation.ts` and `shared-import-violation.ts`; remove `v2/test/fixtures/` when no demo files remain — rules out keeping orphan demo files or an empty fixtures README.
- Biome-gate manual verification uses ephemeral copy-paste examples inline in `coding-standards.md` — rules out retaining a checked-in `v2/test/fixtures/` demo directory.
- No TUI workflow launcher or `loadInkUi` smoke-test replacement in this slice — rules out relocating the Yoga-TDZ regression guard from the deleted test file.
- Yoga-TDZ CI guard from `tui-ink-renderer-isolation` / `tui-ink-linux-bun-regression-ci` is intentionally dropped until a TUI workflow launcher consumer pins relocation — rules out silent doc/code drift claiming CI still guards the regression.
- Revise `v1-behaviors.md` TUI ink section: drop field-collection claims; retain `loadInkUi` boundary bullet for surviving monitor/log-follow/feedback surfaces — rules out deleting the whole section and rotting ink-boundary parity baseline.

## Task checklist

- [ ] Delete `v2/src/tui/tui-field-collector.tsx`.
- [ ] Delete `v2/src/tui/tui-field-collector.test.tsx`.
- [ ] Delete `v2/test/fixtures/complexity-violation.ts`.
- [ ] Delete `v2/test/fixtures/shared-import-violation.ts`.
- [ ] Remove `v2/test/fixtures/` (README and directory).
- [ ] Update `v2/docs/v2-architecture.md`: drop `tui-field-collector.tsx` from TUI host domain-map row; remove grandfathered `v2/test/fixtures/` Biome-demo layout claim.
- [ ] Update `v2/docs/v1-behaviors.md` `### TUI ink rendering and launch field collection`: drop field-collection claims and deleted-module citations; retain `loadInkUi` boundary bullet for surviving TUI ink surfaces.
- [ ] Update `v2/docs/write-behavior.md` Verification: remove `tui-field-collector.test.tsx` citation and Linux/Bun Yoga-TDZ `loadInkUi` smoke-guard claim.
- [ ] Update `v2/docs/coding-standards.md`: replace `v2/test/fixtures/` README verification path with inline ephemeral copy-paste examples.
- [ ] Update `v2/docs/v2-vision.md`: remove `test/fixtures/` and grandfathered Biome-demo fixture layout claims.

## Acceptance criteria

- [x] `v2/src/tui/tui-field-collector.tsx` and `v2/src/tui/tui-field-collector.test.tsx` are absent.
- [x] `v2/test/fixtures/complexity-violation.ts` and `v2/test/fixtures/shared-import-violation.ts` are absent.
- [x] `v2/test/fixtures/` is absent.
- [x] `rg 'tui-field-collector|complexity-violation|shared-import-violation' v2/src v2/test` returns no matches.
- [x] `rg 'smoke: loadInkUi' v2/src` returns no matches.
- [x] `v2/docs/v2-architecture.md` TUI host domain-map row omits `tui-field-collector.tsx` and does not describe an active `v2/test/fixtures/` Biome-demo directory.
- [x] `v2/docs/v1-behaviors.md` has no launch field-collection entry citing `collectLaunchFieldsViaInk` or deleted module paths; surviving TUI ink surfaces still document the `loadInkUi` boundary.
- [x] `v2/docs/write-behavior.md` Verification omits `tui-field-collector.test.tsx` and the Linux/Bun Yoga-TDZ `loadInkUi` smoke-guard claim.
- [x] `v2/docs/coding-standards.md` does not point operators at `v2/test/fixtures/` or its README for Biome-gate verification.
- [x] `v2/docs/v2-vision.md` does not describe `v2/test/fixtures/` or grandfathered Biome-demo fixtures.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v2-architecture.md` — TUI host domain map drops `tui-field-collector.tsx`; source-layout conventions drop active `v2/test/fixtures/` Biome-demo claim.
- `v2/docs/v1-behaviors.md` — revise TUI ink section: drop field-collection claims; retain `loadInkUi` boundary for surviving surfaces.
- `v2/docs/write-behavior.md` — Verification drops deleted test citation and Yoga-TDZ smoke-guard claim.
- `v2/docs/coding-standards.md` — inline ephemeral Biome-gate verification replaces fixtures README path.
- `v2/docs/v2-vision.md` — layout and guiding-principles drop `v2/test/fixtures/` Biome-demo claims.
