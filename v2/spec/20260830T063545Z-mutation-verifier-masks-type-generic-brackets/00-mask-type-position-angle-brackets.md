# 00 - Mask type-position angle brackets in operator-flip extraction

## Problem

`deriveOperatorMutations` in `v2/src/execution/diff-derived-mutation-verifier.ts` scans the masked changed line for comparison-operator tokens (`<`, `>`, `<=`, `>=`, and related `=`/`!` sequences). `maskNonCodeSpans` already masks string literals, template literals, and comments, but TypeScript type-position angle brackets remain visible. Bun strips type annotations at runtime, so flipping `<` in `Parameters<Foo>`, `as Foo<Bar>`, `new Map<string, number>()`, or `fn<T>(...)` is a no-op no scoped test can kill. The verifier reports `surviving_mutation_failed` and strands implement publication even when code and tests are correct.

Observed 2026-08-30 (`share-workflow-start-preparation` implement, run `2b9b5983`): `surviving_mutation_failed` `operator-flip: < → >=` at `v2/src/commands/workflow-start-preparation.ts:92` — the only `<` on the line is in `Parameters<WorkflowPresetBuilder>`.

## Decisions

- Mask type-position `<`/`>` before `deriveOperatorMutations` matches comparison tokens; rules out leaving generic delimiters as flip candidates Bun cannot observe.
- Type-position masking runs on `maskNonCodeSpans` output and is consumed only by `deriveOperatorMutations`; guard and destructive candidate derivation are unchanged; rules out extending `maskNonCodeSpans` or altering non-operator-flip paths.
- Extend the operator-flip line-scoped masking pass rather than replacing `maskNonCodeSpans` or adding a TypeScript parser dependency; rules out a full AST rewrite or a second unrelated masking implementation.
- A genuine value-position comparison on the same line as a type generic remains a candidate (`a < b` beside `Map<string, number>`); rules out whole-line suppression when any generic appears.
- Existing string/template/comment/block-comment masking in `maskNonCodeSpans` stays unchanged; rules out re-lexing those spans in the type-position pass.
- Masking remains line-scoped with the same fail-safe property as other masking limitations: it only removes candidates, never invents false survivals; rules out claiming file-scoped type correctness this slice does not deliver.
- Pinned fixture coverage: `as Parameters<Foo>[0]`, `new Map<string, number>()`, `fn<T>(...)`, `x satisfies Foo<Bar>`, `const assign = <K extends keyof T>(...) => …`; other type forms (nested-generic depth, unpinned `extends` edge cases, old-style assertions, TSX/JSX) deferred to first consumer — pin when a caller needs it.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` proves changed production lines whose only `<`/`>` are type-generic (`x as Parameters<Foo>[0]`, `new Map<string, number>()`, `fn<T>(...)`, `x satisfies Foo<Bar>`, `const assign = <K extends keyof T>(key: K, value: string | undefined): void => { ... }`) yield no operator-flip candidate; fails against the current extraction, which emits one.
- [ ] `diff-derived-mutation-verifier.test.ts` proves a real value comparison (`a < b`) on a line that also contains a generic still yields the comparison as a candidate — constructible on main today; fails only if over-masking removes it.
- [ ] `diff-derived-mutation-verifier.test.ts` regression embeds the production line text from incident `workflow-start-preparation.ts:92` (`const built = await request.builder(request.builderInput as Parameters<WorkflowPresetBuilder>[0]);`) in a synthetic diff (same pattern as `regression: CLEANUP_USAGE line yields no candidate`) and asserts no operator-flip candidate; fails against the pre-change verifier (reachable on main via run `2b9b5983`).
- [ ] Existing `diff-derived-mutation-verifier.test.ts` `describe` blocks stay green: `diff-derived-mutation-verifier`, `verification bounds`, `masking non-code spans`, `maskNonCodeSpans`, `dual-constraint detection`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/workflow-runner.md` completion-verification paragraph records that pinned type-position `<`/`>` forms (generics, type casts, type params, `satisfies`, arrow generic params) are excluded from operator-flip candidates alongside string/template/comment masking, and names residual risks (unpinned nested-generic depth, old-style assertions, TSX/JSX) consistent with existing masking caveats.
- [ ] `v2/docs/v1-behaviors.md` diff-derived mutation evidence entry records the same fixture-bounded type-position bracket masking for comparison-operator candidates and the same residual risks — not complete TypeScript type-syntax exclusion.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion-verification paragraph: fixture-bounded type-position `<`/`>` exclusion for operator-flip candidates; residual risks named.
- `v2/docs/v1-behaviors.md` — diff-derived mutation evidence entry: fixture-bounded type-position bracket masking; residual risks named.
- `v2/docs/test-writing.md` (optional) — pointer to workflow-runner masking semantics.
