# Classify operator-flip candidates with TypeScript syntax

## Problem

`deriveOperatorMutations` in `v2/src/execution/diff-derived-mutation-verifier.ts` regex-scans masked changed-line text for comparison tokens. Type-position `<` and `>` in generics, assertions, type parameters, `satisfies` clauses, and generic arrow functions are treated as runtime comparisons, producing behavior-neutral operator-flip candidates that no Bun test can kill. More masking cannot distinguish type syntax from value expressions without creating its own false comparison candidates.

## Surface

Diff-derived mutation candidate derivation in `v2/src/execution/diff-derived-mutation-verifier.ts`; focused regressions in `v2/src/execution/diff-derived-mutation-verifier.test.ts`; durable workflow and v1-behavior docs. Killing-test resolution, equivalent-mutation directives, per-file scheduling, and verifier bounds are out of scope.

## Decision ledger

- Classify comparison tokens with the TypeScript scanner/AST over the original changed-line source while preserving physical line and column offsets; rules out regex or additional masking heuristics for operator-flip derivation.
- Remove `maskNonCodeSpans` from operator-flip derivation while retaining it for guard-flip and destructive-operation derivation that still need non-code-span suppression; rules out two operator-candidate derivation paths.
- Preserve `columnStart`, `columnEnd`, `originalText`, `mutatedText`, and `operator-flip: …` mutation strings for expression-position comparisons; rules out changing mutation application or surviving-mutation reporting contracts while replacing classification.
- Emit guard-flip candidates before operator-flip candidates on each line and collapse per-line duplicates (same file, line, columns, and mutation string) before `MAX_INSPECTED_MUTATIONS` admission; rules out positional ordering that spends inspection budget on lower-signal or repeated candidates first.
- Deferred to first consumer: exact single-line parse wrapper when a changed line is syntactically invalid in isolation — pin when a failing fixture needs it.

## Tasks

- Replace regex-based operator-flip derivation with TypeScript expression-position classification; keep guard and destructive derivation on masked spans.
- Add per-line guard-before-operator ordering and duplicate collapse in `deriveFromLine` (or equivalent single entry).
- Add focused regressions in `v2/src/execution/diff-derived-mutation-verifier.test.ts` for type-position suppression, mixed type-and-comparison lines, ordering, and deduplication.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` regression `skips operator-flip for type-position angle brackets` drives changed lines whose only angle brackets appear in `x as Parameters<Foo>[0]`, `new Map<string, number>()`, `fn<T>(...)`, `x satisfies Foo<Bar>`, and an arrow generic `<K extends keyof T> =>`, asserts no `operator-flip` candidate is derived for any of them, and fails against the pre-fix regex derivation reachable in `deriveOperatorMutations` today.
- [x] `diff-derived-mutation-verifier.test.ts` regression `derives operator-flip for expression comparisons on lines with type syntax` drives a changed line containing both a real `a < b` comparison and a type generic, asserts an `operator-flip` candidate targets the comparison at its source columns, and fails against the pre-fix classifier that suppresses or misplaces the comparison.
- [x] `diff-derived-mutation-verifier.test.ts` regression `orders guard-flip before operator-flip and collapses per-line duplicates` drives one changed line with both guard-flip and operator-flip opportunities plus a duplicate operator candidate, asserts guard-flip is emitted first, duplicate identities collapse to one entry, and inspection order respects that collapse; it fails against the pre-fix deriver that emits operator-flips before guards or retains duplicates.
- [x] `diff-derived-mutation-verifier.test.ts` `maskNonCodeSpans` describe block stays green (non-code-span suppression for guard and destructive families unchanged).
- [x] `v2/docs/workflow-runner.md` documents TypeScript-based operator classification, exclusion of type-position brackets from operator-flip candidates, and guard-before-operator per-line ordering with duplicate collapse before inspection bounds.
- [x] `v2/docs/v1-behaviors.md` replaces the regex-masked comparison-operator candidate description with scanner/AST-based expression-position classification and the guard-before-operator ordering contract.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — TypeScript-based operator classification, type-position bracket exclusion, guard-before-operator ordering, per-line duplicate collapse.
- `v2/docs/v1-behaviors.md` — scanner/AST expression-position operator candidates replace regex-masked comparison derivation in the diff-derived mutation evidence baseline.
