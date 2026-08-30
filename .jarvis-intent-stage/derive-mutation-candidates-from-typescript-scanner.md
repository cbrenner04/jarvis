---
name: derive-mutation-candidates-from-typescript-scanner
---

# Derive mutation candidates from TypeScript syntax

Unsplit rationale: The behavior changes only execution-loop mutation candidate derivation; its production logic, tests, ordering contract, and durable documentation cover the same module boundary.

## Primary implementation surface

- Execution-loop diff-derived mutation candidate derivation in `v2/src/execution/`

## Prerequisites

- Diff-derived verification provides an auditable escape hatch scoped to one exact file, line, and mutation transform for provably equivalent candidates.

## Problem

- Regex scanning of masked changed-line text treats type-position `<` and `>` as runtime comparison operators, producing equivalent mutations that no Bun test can kill.
- Adding more masking logic creates its own comparison-heavy equivalent candidates and cannot reliably distinguish type syntax from value expressions.

## Behavior

- Type-position brackets in generic arguments, assertions, type parameters, `satisfies` clauses, and generic arrow functions produce no operator-flip candidate.
- Expression-position comparisons still produce operator-flip candidates when their line also contains type syntax.
- Each line emits guard-flips before operator-flips and collapses duplicate candidates before the 25-candidate inspection bound applies.

## Decision ledger

- Classify comparison tokens with the TypeScript scanner and AST; rules out regex or masking heuristics that cannot distinguish type and expression positions.
- Remove `maskNonCodeSpans` from operator-flip derivation while retaining non-code-span handling only where other mutation families still require it; rules out two operator-candidate derivation paths.
- Preserve source columns and mutation text for expression comparisons; rules out changing mutation application or failure-reporting contracts while replacing classification.
- Order guard-flips before operator-flips and deduplicate per line; rules out positional ordering that spends `MAX_INSPECTED_MUTATIONS` on lower-signal or repeated candidates first.

## Acceptance criteria

- [ ] A regression test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves changed lines whose only angle brackets are in `x as Parameters<Foo>[0]`, `new Map<string, number>()`, `fn<T>(...)`, `x satisfies Foo<Bar>`, and an arrow generic `<K extends keyof T>` produce no operator-flip candidate; it fails against the pre-fix regex derivation.
- [ ] A test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a real `a < b` comparison on a line that also contains a type generic remains an operator-flip candidate.
- [ ] A test in `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a line with guard-flip and operator-flip opportunities emits the guard-flip first and collapses per-line duplicates before inspection.
- [ ] Production operator-flip derivation uses TypeScript syntax classification and no longer consumes `maskNonCodeSpans`; the pre-fix `deriveOperatorMutations(..., maskedContent, ...)` call is reachable evidence for this invariant.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document TypeScript-based operator classification, exclusion of type-position brackets, and guard-before-operator ordering.
- `v2/docs/v1-behaviors.md` — replace the regex-masked operator-candidate description with scanner/AST-based expression classification.
