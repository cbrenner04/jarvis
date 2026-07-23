---
name: guard-test-doubles-from-production-behavior
---

# Guard test doubles from production behavior

## Problem

- Review alone does not prevent fixtures under `v2/src/testing/**` from computing double responses with production behavior they stand in for.

## Outcome

- `bun run check` rejects value-producing production calls used to compute test-double responses under `v2/src/testing/**`.
- Guard fixtures pin the rejected production-call pattern and permitted type-only, constant, and builder imports.

## Decisions

- Guard behavioral calls used to produce double values; rules out a blanket ban on production imports from test fixtures.
- Permit type-only imports, constants, and builders; rules out forcing fixtures to duplicate shared declarations or construction utilities.
- Pin rejected and allowed forms in guard tests; rules out relying on review interpretation or an untested scanner.

## Acceptance criteria

- [ ] The `test-doubles production-call guard` regression test rejects the known `advanceLoadedRevision` response-computation pattern and fails without the guard.
- [ ] The `test-doubles production-call guard` regression test accepts type-only, constant, and builder imports.
- [ ] The guard scans `v2/src/testing/**` and runs through `bun run check`.
- [ ] `bun run check`, `bun run typecheck`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — doubles must not compute responses with production behavior they stand in for, including the guard's rejected and allowed uses.

## Prerequisites

- CLI test doubles no longer compute status replies with production revision-advance behavior.
