# Drop shared partition guard invert hook

`shared/module-boundary-surfaces.ts` exports `setInvertPartitionGuardForTest` so plan-split
partition guard-inversion ACs pass without mutating the real `bulletsForBoundary` surface filter.

## Prerequisites

- Plan and implement write-step rules name comment-checkpoint source mutation and forbid production invert hooks (`write-step-rules-forbid-production-invert-hooks`). Static `setInvert*ForTest` scanning deferred to `guard-production-test-flags`.

## Decisions

- Delete `invertPartitionGuardForTest`, `setInvertPartitionGuardForTest`, and the `bulletsForBoundary` early-return branch — rules out keeping shared production state as a `guard-production-test-flags` evasion path.
- Remove `inverting partition guard fails k2 draft-scope preservation` — its negative contract (partition bleed into persistence child sections when the guard is bypassed) is carried by `normalizes the k2 staged tree without provenance` turning red under source mutation, not a dedicated invert `test()` or production bypass branch.
- Guard-inversion evidence is a comment checkpoint on `normalizes the k2 staged tree without provenance` naming a source mutation on the `bulletsForBoundary` filter (`return bullets.filter(...)` → `return [...bullets]`) — rules out setter-based inversion or deleting inversion coverage.
- No new production invert hooks in any of the four forbidden shapes — rules out a parallel bypass branch.

## Tasks

- Remove `invertPartitionGuardForTest`, `setInvertPartitionGuardForTest`, and the `if (invertPartitionGuardForTest) return [...bullets]` branch from `shared/module-boundary-surfaces.ts`.
- Drop `setInvertPartitionGuardForTest` import, `afterEach` reset, and `inverting partition guard fails k2 draft-scope preservation` from `shared/module-boundary-surfaces.test.ts`.
- Add a comment checkpoint on `normalizes the k2 staged tree without provenance` documenting guard inversion: bypass = disabling the `bulletsForBoundary` surface filter (`return bullets.filter(...)` → `return [...bullets]`); operator verifies that test turns red under that mutation (other k2 cases may also red).
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `shared/**/*.ts` outside `*.test.ts` exports no `setInvert*ForTest` and declares no `invert*ForTest` module variables.
- [x] `module-boundary-surfaces.test.ts` — `inverting partition guard fails k2 draft-scope preservation` is removed; guard inversion is documented in a comment checkpoint on `normalizes the k2 staged tree without provenance` naming bypass via `bulletsForBoundary` filter mutation (`return bullets.filter(...)` → `return [...bullets]`); operator verifies that test turns red under that mutation. (Manual)
- [x] `module-boundary-surfaces.test.ts` — `normalizes the k2 staged tree without provenance` turns red when the named `bulletsForBoundary` filter mutation is applied (other k2 assertions may also fail). (Manual)
- [x] `module-boundary-surfaces.test.ts` — `normalizes the k2 staged tree without provenance` stays green (k2 draft-scope preservation under the real guard; behavior unchanged by hook removal).
- [x] `module-boundary-surfaces.test.ts` — `inverting draft dependency order guard fails k4` stays green (behavior unchanged by partition-hook removal).
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass for touched shared files.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
