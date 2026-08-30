# Derive mutation candidates from the TypeScript scanner, retiring the regex masking pass

Re-scopes `mutation-verifier-masks-type-generic-brackets` (removed). That seed's masking-loop approach is a dead end: the comparison-heavy angle-bracket masking loop stranded its own implement **three times** on an equivalent mutant in the loop (`operator-flip: > → <=` on a `depth > 0` bound; redundant `chars[i] === "<"` guards) — regex/masking will always generate equivalents. Its pipeline PRs (#3164/#3166/#3169) were closed unlanded; the spec was never on `main`.

## Problem

The diff-derived mutation verifier derives operator-flip candidates from a regex/masking pass (`maskNonCodeSpans` + line scans). It cannot reliably tell an expression-position comparison (`a < b`) from a type-position bracket (`Parameters<Foo>`, `x as Foo<Bar>`, `new Map<string, number>()`, `fn<T>(...)`, `x satisfies Foo<Bar>`, `<K extends keyof T>`). Bun strips type annotations at runtime, so a mutation of a type-position `<`/`>` is a no-op no test can kill — a false `surviving_mutation_failed` that strands correct implements (observed 2026-08-30, `share-workflow-start-preparation` run `2b9b5983` at `workflow-start-preparation.ts:92`). The masking workaround adds its own equivalent-mutant-prone loop.

## Decisions

- Candidate derivation classifies tokens via the TypeScript scanner/AST (`typescript` is already a project dependency), not regex masking. Operator-flip candidates are emitted only for **expression-position** comparison operators; type-position `<`/`>` (generic arguments, type casts, type parameters, `satisfies`) yield no candidate. Rules out the regex/masking approach and its equivalents.
- The regex masking pass (`maskNonCodeSpans` for operator-flip purposes) retires with this change. Rules out maintaining two candidate-derivation paths.
- Candidate ordering: guard-flips before operator-flips, deduped per line, so the 25-candidate cap (`MAX_INSPECTED_MUTATIONS`) spends on the highest-signal mutants first. Rules out arbitrary/positional ordering that wastes the cap on low-signal candidates.
- Preserve the existing behavior contract: a type-generic-only line yields no operator-flip candidate; a real `a < b` on a line that also contains a generic still yields the comparison as a candidate. Rules out over-suppression (dropping real comparisons) or under-suppression (keeping type brackets).

## Acceptance criteria

- [ ] A verifier unit test proves a changed line whose only `<`/`>` are type-position (`x as Parameters<Foo>[0]`, `new Map<string, number>()`, `fn<T>(...)`, `x satisfies Foo<Bar>`, an arrow generic `<K extends keyof T>`) yields NO operator-flip candidate; it fails against the pre-fix regex derivation, which emits one.
- [ ] A verifier unit test proves a real value comparison (`a < b`) on a line that also contains a type generic still yields the comparison as an operator-flip candidate — no over-suppression.
- [ ] A verifier unit test pins candidate ordering: on a line with both a guard-flip and an operator-flip candidate, the guard-flip is emitted first (and per-line duplicates are collapsed).
- [ ] The regex `maskNonCodeSpans`-based operator-flip derivation is absent from production (string/comment/template masking for other purposes may remain if still used elsewhere).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion-verification: operator-flip candidates come from TypeScript-scanner token classification; type-position brackets are excluded; guard-flips ordered before operator-flips.
- `v2/docs/v1-behaviors.md` — diff-derived mutation evidence: candidate derivation is scanner-based, not regex-masked.

## Sequencing

Land after [[mutation-gate-equivalent-mutation-escape-hatch]] (escape hatch is the pressure valve if this fix's own implementation trips an equivalent mutant while landing). When this seed lands, confirm no stale masking-loop artifacts remain (the old spec was never merged to `main`; only the removed seed existed).
