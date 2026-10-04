# Pin biome unsafe findIndex autofix

`bun run fix` can rewrite `findIndex` to `indexOf` on a possibly-`undefined` needle and leave `bun run typecheck` red on a clean tree.

## Decision ledger

- Disable or scope `complexity/useIndexOf` behind `bun run fix` so the unsafe `findIndex` → `indexOf` rewrite is not applied — rules out leaving a known-red autofix armed while later subspecs rely on autofix.

## Task checklist

- Adjust `biome.json` (or equivalent config behind `check:fix:unsafe`) for the `complexity/useIndexOf` unsafe rewrite.
- Add `scripts/biome-useindexof-autofix.test.ts` with a possibly-`undefined` needle fixture that pins the rewrite as not applied.

## Acceptance criteria

- [x] `bun run fix` on a clean checkout leaves `bun run typecheck` green.
- [x] `scripts/biome-useindexof-autofix.test.ts` "does not rewrite findIndex to indexOf when needle is possibly undefined" pins the unsafe `findIndex` → `indexOf` rewrite as not applied; it fails against the pre-fix config.

## Documentation updates

- None; config-only change with no operator-facing semantics shift.
