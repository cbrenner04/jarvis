# Remove unreferenced v2 source and fixture files

Delete four files with zero production or test consumers outside their own
pairing: `tui-field-collector.tsx` + co-located test, and two Biome-gate demo
fixtures with zero references. No replacements, stubs, or relocated helpers.

## Decisions

- Delete `v2/src/tui/tui-field-collector.tsx` and `tui-field-collector.test.tsx` — rules out stubbing or relocating field collection ahead of a real TUI workflow launcher consumer.
- Delete `v2/test/fixtures/complexity-violation.ts` and `shared-import-violation.ts` — rules out keeping orphan demo files.
- No TUI workflow launcher or `loadInkUi` smoke-test replacement in this slice — rules out relocating the Yoga-TDZ regression guard from the deleted test file.
- Update `v2/test/fixtures/README.md` to drop sections for deleted fixtures; delete the README if no demo files remain — rules out README entries for absent files.

## Task checklist

- [ ] Delete `v2/src/tui/tui-field-collector.tsx`.
- [ ] Delete `v2/src/tui/tui-field-collector.test.tsx`.
- [ ] Delete `v2/test/fixtures/complexity-violation.ts`.
- [ ] Delete `v2/test/fixtures/shared-import-violation.ts`.
- [ ] Update `v2/test/fixtures/README.md` per the decisions above.
- [ ] Update `v2/docs/v2-architecture.md` TUI host domain-map row: drop `tui-field-collector.tsx` from the module list.
- [ ] Update `v2/docs/v1-behaviors.md`: remove the `### TUI ink rendering and launch field collection` section (sole bullet cites deleted modules).
- [ ] Update `v2/docs/write-behavior.md` Verification: remove the `tui-field-collector.test.tsx` / `loadInkUi` smoke citation.

## Acceptance criteria

- [ ] `v2/src/tui/tui-field-collector.tsx` and `v2/src/tui/tui-field-collector.test.tsx` are absent.
- [ ] `v2/test/fixtures/complexity-violation.ts` and `v2/test/fixtures/shared-import-violation.ts` are absent.
- [ ] `rg 'tui-field-collector|complexity-violation|shared-import-violation' v2/src v2/test` returns no matches.
- [ ] `v2/docs/v2-architecture.md` TUI host domain-map row omits `tui-field-collector.tsx`.
- [ ] `v2/docs/v1-behaviors.md` has no launch field-collection entry citing `collectLaunchFieldsViaInk` or deleted module paths.
- [ ] `v2/docs/write-behavior.md` Verification section does not cite `tui-field-collector.test.tsx`.
- [ ] `v2/test/fixtures/README.md` does not document deleted fixture files.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v2-architecture.md` — TUI host domain map drops `tui-field-collector.tsx`.
- `v2/docs/v1-behaviors.md` — remove launch field-collection section citing deleted modules.
- `v2/docs/write-behavior.md` — remove `tui-field-collector.test.tsx` smoke citation from Verification.
