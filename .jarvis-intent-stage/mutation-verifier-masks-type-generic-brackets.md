---
name: mutation-verifier-masks-type-generic-brackets
---

# Mutation verifier masks type-generic angle brackets from operator-flip candidates

Unsplit rationale: Operator-flip masking, candidate-extraction tests, and the test-writing note all land on the diff-derived mutation verifier execution-loop boundary.

## Primary implementation surface

- execution-loop — `diff-derived-mutation-verifier` operator-flip candidate extraction

## Problem

The diff-derived mutation verifier's operator-flip candidate extraction treats the `<`/`>` in TypeScript generic-argument and type-cast positions (`Parameters<Foo>`, `x as Foo<Bar>[0]`, `new Map<string, number>()`, `fn<T>(...)`) as numeric comparison operators and mutates them (e.g. `< → >=`). Bun strips type annotations at runtime, so such a mutation is a no-op no test can kill — the verifier reports a `surviving_mutation_failed` that strands the implement run at publication even though the code and its tests are correct. `maskNonCodeSpans` (`v2/src/execution/diff-derived-mutation-verifier.ts`) masks strings/comments/regex but not type-position angle brackets.

## Evidence (2026-08-30)

`share-workflow-start-preparation` implement (spec `20260830T025737Z-share-workflow-start-preparation`), run `2b9b5983`, settled `surviving_mutation_failed` `operator-flip: < → >=` at `v2/src/commands/workflow-start-preparation.ts:92`:

```ts
const built = await request.builder(request.builderInput as Parameters<WorkflowPresetBuilder>[0]);
```

The only `<` on the line is the `Parameters<WorkflowPresetBuilder>` generic. Independent diff review confirmed the false-positive; the run was hand-finished (PR #3143) after the mutation was ruled a verifier artifact, not a coverage gap.

## Decisions

- The operator-flip candidate extraction (or `maskNonCodeSpans`) excludes TypeScript type-annotation and generic-argument positions from `<`/`>`/`<=`/`>=` mutation candidates — only value-position comparisons are candidates. Rules out flipping delimiters that bun strips at runtime.
- Distinguish type-position brackets (after an identifier/`as`/`satisfies`, in type params, in `Array<…>`-style generics) from value comparisons on the same line, so a real `a < b` on a line that also contains a generic is still a candidate. Rules out over-masking that would hide genuine comparison guards.
- Existing string/comment/regex masking is unchanged. Rules out a rewrite of the whole masking pass.

## Acceptance criteria

- [ ] A verifier unit test proves a production line whose only `<`/`>` are type-generic (`x as Parameters<Foo>[0]`, `new Map<string, number>()`) yields NO operator-flip mutation candidate; it fails against the current extraction, which emits one.
- [ ] A verifier unit test proves a real value comparison (`a < b`) on a line that also contains a generic still yields the comparison as a candidate — no over-masking.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — note that type-position angle brackets are excluded from operator-flip candidates.

## Prerequisites
