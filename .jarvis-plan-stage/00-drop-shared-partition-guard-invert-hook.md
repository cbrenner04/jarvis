# Drop shared partition guard invert hook

`shared/module-boundary-surfaces.ts` exports `setInvertPartitionGuardForTest` so plan-split
partition guard-inversion ACs pass without mutating the real `bulletsForBoundary` surface filter.

## Decisions

- Delete `invertPartitionGuardForTest`, `setInvertPartitionGuardForTest`, and the `bulletsForBoundary` early-return branch — rules out keeping shared production state as a `guard-production-test-flags` evasion path.
- Guard-inversion evidence is a comment checkpoint on `inverting partition guard fails k2 draft-scope preservation` naming a source mutation on the `bulletsForBoundary` filter (`return bullets.filter(...)` → `return [...bullets]`) — rules out setter-based inversion or deleting inversion coverage.
- Rewritten invert test pins k2 draft-scope preservation under the real guard (positive assertions); applying the named mutation turns those assertions RED — rules out a dedicated invert `test()` that only toggles a production hook.
- No new production invert hooks in any of the four forbidden shapes — rules out a parallel bypass branch.

## Tasks

- Remove `invertPartitionGuardForTest`, `setInvertPartitionGuardForTest`, and the `if (invertPartitionGuardForTest) return [...bullets]` branch from `shared/module-boundary-surfaces.ts`.
- Drop `setInvertPartitionGuardForTest` import and `afterEach` reset from `shared/module-boundary-surfaces.test.ts`.
- Rewrite `inverting partition guard fails k2 draft-scope preservation` to assert k2 preservation under the real guard; add a comment checkpoint naming the `bulletsForBoundary` filter mutation above.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `shared/**/*.ts` outside `*.test.ts` exports no `setInvert*ForTest` and declares no `invert*ForTest` module variables.
- [ ] `module-boundary-surfaces.test.ts` — rewritten guard-inversion test (no `setInvertPartitionGuardForTest` import) fails against pre-fix production hook export and passes after removal.
- [ ] `module-boundary-surfaces.test.ts` test `inverting partition guard fails k2 draft-scope preservation` fails when its named `bulletsForBoundary` filter mutation is applied.
- [ ] `bun run typecheck` and `bun run test:v2` pass for touched shared files.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
