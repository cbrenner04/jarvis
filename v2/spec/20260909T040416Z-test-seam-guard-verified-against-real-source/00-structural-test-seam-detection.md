# 00 - Structural test-seam detection

## Problem

`scripts/guard-production-test-flags.ts` regex-scans brace windows. Three independent faults hide every real seam: the type-alias class omits `&`/`|` (intersection dep bags), `[^}]*` cannot cross a nested object member, and `<[^>]*` cannot cross an earlier generic. The export rule requires a literal `set` prefix, so an exported `*ForTest` helper is covered by nothing. 74 single-line synthetic fixtures pass against this inert scanner; `bun run scripts/guard-production-test-flags.ts` exits 0 on `main` with `bypassPersistedReadyGateRepairFenceForTest`, `mutationRepairBindingFactoryForTest`, `resetVerifierTestRunTrackingForTest`, and `isInsideTimerCallbackForTest` present in production source.

## Decisions

- Detection walks the TypeScript AST (`typescript` is already a dependency) over declarations: property signatures in interfaces and type literals (at any nesting, including intersection and union members and type-parameter constraints), parameters of functions, methods, constructors, and arrows, module-level `const`/`let`/`var`, and exported function or variable declarations and `export { … }` specifiers; rules out extending brace-window regexes one shape at a time.
- Forbidden identifier test: ends with `ForTest` or `ForTests`, or (parameters only) starts with `invert`; an exported function or variable so named is a violation regardless of any `set` prefix; rules out the name-prefix assumption that excluded the most common seam.
- Mere mentions never fire: a type reference or generic argument (`Map<string, RunnerForTests>`), a property access, or a control-flow condition (`if (fooForTest)`) is not a declaration; rules out the false positives the current generic and window patterns produce.
- `SHAPES` labels stay stable for existing consumers (`setInvert*ForTest export`, `invert*ForTest module variable`, `invert* parameter`, `invert*ForTest type member`, `set*ForTest export`, `*ForTest module variable`, `*ForTest parameter`, `*ForTest type member`) and gain `*ForTest export` for the non-`set` exported helper; `findProductionInvertHookViolations`, `runProductionInvertHookGuard`, `isTestFile`, `shouldScanFile`, scan roots, `.test.` exclusion, and the `shared/prompts/step-rules.ts` skip are unchanged.
- The rejection corpus is lifted verbatim from real `v2/src` shapes on `main` today: `WriteLoopInput` with `bindingResolution?: { … }` preceding `bypassPersistedReadyGateRepairFenceForTest?: boolean`, `ReviewMutationResumeDeps` as an intersection alias carrying both fence and factory members, and the two exported verifier helpers; rules out synthetic single-line fixtures as sufficient evidence for a scanner whose job is matching real code.
- A meta-test enumerates candidate seams in `v2/src` and `shared` at run time (identifiers matching `ForTests?$` or `^invert` in declaration position — not preceded by `.` and followed by `?:`, `:`, `(`, `=`, `,`, or `)`) and asserts the guard reports every one at the same file and line; rules out a hand manifest that rots as seams come and go. The meta-test passes vacuously on a seam-free tree, which is the intended end state after `01`.

## Tasks

- Rewrite the detectors in `scripts/guard-production-test-flags.ts` over `ts.createSourceFile` + a recursive node walk; keep the file-collection, scope, and CLI shell.
- Replace the synthetic fixtures in `scripts/guard-production-test-flags.test.ts` with the real-source corpus, keep every existing invert-shape case green, and add the false-positive pins and the run-time meta-test.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.test.ts` test `flags a ForTest member after a nested object member in a real WriteLoopInput excerpt` proves the guard reports `bypassPersistedReadyGateRepairFenceForTest` at its real position inside a type with a nested object member preceding it; it fails against the current `[^}]*` window.
- [ ] `scripts/guard-production-test-flags.test.ts` test `flags a seam declared on an intersection type alias` proves `type A = B & { fooForTest?: boolean }` is reported; it fails against the current type-alias character class.
- [ ] `scripts/guard-production-test-flags.test.ts` test `flags an exported ForTest function without a set prefix` proves `export function resetVerifierTestRunTrackingForTest(): void {}` is reported as `*ForTest export`; it fails against the current export rule.
- [ ] `scripts/guard-production-test-flags.test.ts` test `does not flag mentions that are not declarations` proves `new Map<string, RunnerForTests>()`, `deps.fooForTest === true`, and `if (fooForTest) {` produce no violation; it fails against the current generic-window pattern.
- [ ] `scripts/guard-production-test-flags.test.ts` test `reports every seam present in the scan roots` enumerates candidate seams at run time and proves the guard reports each at its file and line; it fails against the current inert scan on the pre-`01` tree.
- [ ] `scripts/guard-production-test-flags.test.ts` invert-shape and scope/skip cases stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

None in this subspec — `02` aligns the docs once the enforced shape set is real.
