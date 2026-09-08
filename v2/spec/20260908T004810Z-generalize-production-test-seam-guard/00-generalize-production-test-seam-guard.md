# Generalize production test-seam guard

`scripts/guard-production-test-flags.ts` regexes only the historical `invert*ForTest` family and misses generalized `ForTest`/`ForTests` setters, module variables, parameters, and type members that remain reachable in production `v2/src`, `v1/src`, and `shared` outside test files.

## Decisions

- Broaden detection to six enforced shape families (each matching both `ForTest` and `ForTests` suffixes where applicable): `set*ForTest`/`set*ForTests` exports, `*ForTest`/`*ForTests` module variables, `invert*` function parameters (unchanged), `*ForTest`/`*ForTests` function parameters, `invert*ForTest` type members (unchanged naming for the invert-only member shape), and `*ForTest`/`*ForTests` type members — rules out a guard that only covers the last incident `invert*` family.
- Keep scanning `v2/src`, `v1/src`, and `shared` with the existing `.test.` basename exclusion and `shared/prompts/step-rules.ts` path skip — rules out limiting the guard to daemon-only paths or adding a hook-name allowlist.
- `set*ForTest`/`set*ForTests`: exported function or `export`/`export const` binding whose identifier matches `set\w+ForTests?` (covers `setInvert*ForTest`).
- `*ForTest`/`*ForTests` module variable: top-level `let`/`const`/`var` whose identifier ends with `ForTest` or `ForTests` (covers `invert*ForTest` module lets).
- `invert*` function parameter: unchanged — parameter identifier starting with `invert` in function, method, arrow, or constructor signatures.
- `*ForTest`/`*ForTests` function parameter: parameter identifier ending with `ForTest` or `ForTests` that does not start with `invert` — rules out double-reporting identifiers already covered by the `invert*` parameter shape.
- `invert*ForTest` type member: unchanged property or type-parameter identifier matching `invert\w+ForTest`.
- `*ForTest`/`*ForTests` type member: property or type-parameter identifier ending with `ForTest` or `ForTests` that does not match `invert\w+ForTest` — rules out duplicate violations for invert-prefixed members.
- Non-`set*` exported helpers ending in `ForTest` (for example `resetVerifierTestRunTrackingForTest`) stay out of scope — rules out banning every `ForTest`-suffixed export when the intent targets setter/module/param/type-member seams.
- Retain exported `findProductionInvertHookViolations` and `runProductionInvertHookGuard` names — rules out churn in the single importer (`scripts/guard-production-test-flags.test.ts`) without a rename payoff.
- Lands after index implement-order prerequisites merge — rules out a green `bun run check` on a tree that still carries reachable generalized `*ForTest` production type members.
- Mirror generalized forbidden shapes in `shared/prompts/step-rules.ts` and pin the prompt line in `v2/src/execution/write.test.ts` — rules out agents seeing stale invert-only prohibition text after the guard broadens.

## Tasks

- Extend `scripts/guard-production-test-flags.ts` with generalized shape detectors and `SHAPES` labels; keep existing invert-only detectors and dedupe logic.
- Extend `scripts/guard-production-test-flags.test.ts` with rejected and allowed synthetic fixtures per generalized shape across `v2/src`, `v1/src`, and `shared`; include at least one rejected `setFooForTest` export, `fooForTest` module variable, `fooForTest` parameter, and `fooForTest` type member; retain all existing invert-shape cases.
- Update `shared/prompts/step-rules.ts` prohibition line to list the generalized guard shapes (retain `invert*` parameter prohibition).
- Update `v2/src/execution/write.test.ts` prompt assertions that pin the step-rules prohibition text.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.test.ts` — a rejected synthetic `export function setFooForTest` fixture under each scan root fails against the pre-fix guard and passes after; allowed `.test.ts` / `.test.tsx` fixtures for the same export pass; the suite passes on the clean tree after index implement-order prerequisites land.
- [ ] `scripts/guard-production-test-flags.test.ts` — rejected synthetic fixtures for a `fooForTest` module variable, a non-`invert*` `fooForTest` function parameter, and a non-`invert*` `fooForTest` type member each fail against the pre-fix guard and pass after; `scripts/guard-production-test-flags.test.ts` invert-shape cases stay green.
- [ ] `v2/src/execution/write.test.ts` — implement write-step prompt test pins the updated generalized prohibition line from `shared/prompts/step-rules.ts`.
- [ ] `package.json` — `check` still invokes `scripts/guard-production-test-flags.ts` and passes on the clean tree.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- None in this subspec — durable operator docs land in [01](./01-align-coding-standards-test-seam-section.md) and [02](./02-align-test-writing-forbidden-seams.md).
