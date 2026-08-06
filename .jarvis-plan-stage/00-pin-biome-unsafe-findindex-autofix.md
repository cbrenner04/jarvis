# Pin biome unsafe findIndex autofix

`bun run fix` can rewrite `findIndex` to `indexOf` on a possibly-`undefined` needle and leave `bun run typecheck` red on a clean tree.

## Decision ledger

- Disable or scope the offending Biome rule behind `bun run fix` so the unsafe `findIndex` → `indexOf` rewrite is not applied — rules out leaving a known-red autofix armed while later subspecs rely on autofix.

## Task checklist

- Adjust `biome.json` (or equivalent config behind `check:fix:unsafe`) for the unsafe rewrite.
- Add a regression that pins the specific rewrite as not applied on a possibly-`undefined` needle fixture.

## Acceptance criteria

- [ ] `bun run fix` on a clean checkout leaves `bun run typecheck` green.
- [ ] A regression test pins the specific unsafe `findIndex` → `indexOf` rewrite (possibly-`undefined` needle) as not applied; it fails against the pre-fix config.

## Documentation updates

- None; config-only change with no operator-facing semantics shift.
