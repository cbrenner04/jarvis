# Guard production invert-for-test hooks

Review and write-step rules still miss production invert-for-test hooks when agents add
`setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters,
or `invert*ForTest` type members outside `*.test.ts`. Ship a static guard under `bun run check`
matching all four shapes across `v2/src/**`, `v1/src/**`, and `shared/**`.

## Decisions

- `scripts/guard-production-test-flags.ts` scans `v2/src/**`, `v1/src/**`, and `shared/**` excluding `*.test.ts` for all four hook shapes — rules out export-only matching.
- Exported pure `findProductionInvertHookViolations` over `{ file, source }` records plus a `cwd`-rooted walker and `import.meta.main` CLI — rules out filesystem-only testing or a non-composable guard API.
- Include `*.ts` and `*.tsx` under the three roots — rules out a `.ts`-only scan that misses TSX production surfaces.
- `setInvert*ForTest`: exported function or `export`/`export const` binding whose identifier matches `setInvert\w+ForTest`.
- `invert*ForTest` module variable: top-level `let`/`const`/`var` whose identifier matches `invert\w+ForTest`.
- `invert*` function parameter: parameter identifier starting with `invert` in function, method, arrow, or constructor signatures (including optional/`?` and rest forms).
- `invert*ForTest` type member: property or type-parameter identifier matching `invert\w+ForTest` in `type`, `interface`, or inline object-type positions.
- No production allowlist — rules out grandfathering residual hooks; prerequisite specs already removed them.
- Wire into `package.json` `check` beside existing `scripts/guard-*.ts` runners — rules out a standalone script operators forget.
- Unit tests use synthetic `{ file, source }` fixtures for pass/fail cases per root (`v2/src`, `v1/src`, `shared`) — rules out temp on-disk fixture trees for shape coverage.
- Guard-inversion pin: flip the `.test.ts` exclusion so test paths are scanned — rules out an untested extension gate.

## Tasks

- Add `scripts/guard-production-test-flags.ts` implementing the four-shape detector, file collector, stderr reporter (`<file>:<line>: <shape>`), and non-zero exit on violations.
- Add `scripts/guard-production-test-flags.test.ts` with rejected and allowed synthetic fixtures covering each shape and each scan root; include a `.test.ts` allowed case per rejected shape.
- Add a guard-inversion subcase: comment checkpoint names mutating the `.test.ts` exclusion; flipping that exclusion must RED the subcase against the real guard source.
- Append `bun run scripts/guard-production-test-flags.ts` to the `check` script in `package.json`.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.test.ts` — a rejected-fixture case for `export function setInvertFooForTest` in a non-`.test.ts` file under each of `v2/src/**`, `v1/src/**`, and `shared/**` fails against the pre-guard tree and passes after; a matching `.test.ts` fixture for the same export passes.
- [ ] `scripts/guard-production-test-flags.test.ts` — rejected-fixture cases for a non-test `invertFooForTest` module variable, an `invertFoo` / `invertFooForTest` function parameter, and an `invertFooForTest` type member each fail pre-guard and pass post-guard; matching `.test.ts` fixtures pass.
- [ ] `scripts/guard-production-test-flags.test.ts` — inverting the `.test.ts` exclusion (per the comment checkpoint naming that mutation on `scripts/guard-production-test-flags.ts`) makes the extension-gate subcase RED.
- [ ] `bun run check` runs the guard and passes against the current tree with zero allowlist entries.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — section: no production state exists solely for tests; `bun run check` rejects all four invert-for-test hook shapes via `scripts/guard-production-test-flags.ts` (mirror the synchronous-subprocess guard bullet style).
- `v2/docs/test-writing.md` — replace the ready-intent pointer that says the guard is not wired into `bun run check` with the shipped guard under `check`; keep the four-shape list and comment-checkpoint guard-inversion contract unchanged.
