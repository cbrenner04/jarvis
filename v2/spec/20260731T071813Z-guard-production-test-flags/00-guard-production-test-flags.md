# Guard production invert-for-test hooks

Review and write-step rules still miss production invert-for-test hooks when agents add
`setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters,
or `invert*ForTest` type members outside test files. Ship a static guard under `bun run check`
matching all four shapes across `v2/src/**`, `v1/src/**`, and `shared/**`.

## Decisions

- Lands **last** in the mutant-fix chain after every `*-drop-production-invert-hooks` sibling is merged — rules out implementing on a tree that still carries forbidden hooks.
- `scripts/guard-production-test-flags.ts` scans `v2/src/**`, `v1/src/**`, and `shared/**` excluding files whose basename contains `.test.` (covers `*.test.ts` and `*.test.tsx`) for all four hook shapes — rules out export-only matching or a `.test.ts`-only exclusion that mis-scans `v2/src/tui/*.test.tsx`.
- Include `*.ts` and `*.tsx` under the three roots — rules out a `.ts`-only scan that misses TSX production surfaces.
- `setInvert*ForTest`: exported function or `export`/`export const` binding whose identifier matches `setInvert\w+ForTest`.
- `invert*ForTest` module variable: top-level `let`/`const`/`var` whose identifier matches `invert\w+ForTest`.
- `invert*` function parameter: parameter identifier starting with `invert` in function, method, arrow, or constructor signatures (including optional/`?` and rest forms).
- `invert*ForTest` type member: property or type-parameter identifier matching `invert\w+ForTest` in `type`, `interface`, or inline object-type positions.
- Skip `shared/prompts/step-rules.ts` by path — its rule text quotes the forbidden identifier patterns in a string literal; rules out a hook-name allowlist and rules out string-literal-only detection that would miss real violations elsewhere.
- No hook-name allowlist — rules out grandfathering residual hooks; prerequisite specs already removed them.
- Exported pure `findProductionInvertHookViolations` over `{ file, source }` records plus a `cwd`-rooted walker and `import.meta.main` CLI — rules out filesystem-only testing or a non-composable guard API.
- Wire into `package.json` `check` beside existing `scripts/guard-*.ts` runners and update the pinned `check` string in `v1/test/ready-script.sandbox-unrunnable.test.ts` — rules out a standalone script operators forget or a suite break on wiring.
- Unit tests use synthetic `{ file, source }` fixtures for pass/fail cases per root (`v2/src`, `v1/src`, `shared`) — rules out temp on-disk fixture trees for shape coverage.
- Guard-inversion pin: flip the `.test.` basename exclusion so test paths are scanned — rules out an untested extension gate.

## Tasks

- Add `scripts/guard-production-test-flags.ts` implementing the four-shape detector, `.test.` basename exclusion, `shared/prompts/step-rules.ts` path skip, file collector, stderr reporter (`<file>:<line>: <shape>`), and non-zero exit on violations.
- Add `scripts/guard-production-test-flags.test.ts` with rejected and allowed synthetic fixtures covering each shape and each scan root; include a `.test.ts` and a `.test.tsx` allowed case per rejected shape (at least one rejected fixture on a `*.tsx` production path).
- Add a guard-inversion subcase with a comment checkpoint on the pinning test naming the `.test.` exclusion mutation on `scripts/guard-production-test-flags.ts`; flipping that exclusion must RED the subcase against the real guard source.
- Append `bun run scripts/guard-production-test-flags.ts` to the `check` script in `package.json`.
- Update `v1/test/ready-script.sandbox-unrunnable.test.ts` `package biome scripts use bun's resolved biome binary` to pin the new `check` string.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.test.ts` — a rejected-fixture case for `export function setInvertFooForTest` in a non-test file under each of `v2/src/**`, `v1/src/**`, and `shared/**` fails against the pre-guard tree and passes after; matching `.test.ts` and `.test.tsx` fixtures for the same export pass.
- [ ] `scripts/guard-production-test-flags.test.ts` — rejected-fixture cases for a non-test `invertFooForTest` module variable, an `invertFoo` / `invertFooForTest` function parameter, and an `invertFooForTest` type member each fail pre-guard and pass post-guard; matching `.test.ts` and `.test.tsx` fixtures pass; at least one rejected fixture uses a `*.tsx` production path.
- [ ] `scripts/guard-production-test-flags.test.ts` — inverting the `.test.` basename exclusion on `scripts/guard-production-test-flags.ts` (per the pinning-test comment checkpoint naming that mutation) makes the extension-gate subcase RED.
- [ ] `bun run check` runs the guard and passes against the current tree with zero hook-name allowlist entries and only the `shared/prompts/step-rules.ts` path skip.
- [ ] `v1/test/ready-script.sandbox-unrunnable.test.ts` test `package biome scripts use bun's resolved biome binary` pins the updated `check` script string including the new guard.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — new section (mirror synchronous-subprocess guard bullet style): production code under `v2/src`, `v1/src`, and `shared` must not carry the four invert-for-test hook shapes (`setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters, `invert*ForTest` type members); `bun run check` enforces via `scripts/guard-production-test-flags.ts`. Other `*ForTest` hooks remain out of scope.
- `v2/docs/test-writing.md` — replace the ready-intent pointer that says the guard is not wired into `bun run check` with the shipped guard under `check`; keep the four-shape list and comment-checkpoint guard-inversion contract unchanged.
