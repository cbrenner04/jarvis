---
name: accept-exact-equivalent-mutation-directives
---

# Accept exact equivalent-mutation directives

## Prerequisites

## Primary implementation surface

- Diff-derived mutation verification in the execution loop

## Problem

- A behavior-neutral mutation survives every co-located test, so the mandatory completion verifier strands a correct implementation with no auditable escape hatch.

## Behavior

- The physical source line producing a candidate may carry exactly `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>`; each JSON string uses standard JSON escaping, mutation equals the verifier-generated string, and reason decodes to non-empty text.
- That colocated directive accepts its candidate without requiring a vacuous killing test.
- Acceptance is scoped to the candidate's exact file, line, and mutation; other candidates on the line and the same mutation elsewhere remain blocking.
- A passing verification result reports each accepted site's file, line, mutation, and reason for downstream audit.
- Operator guidance says to remove cheap redundancy first and reserve the directive for provably behavior-neutral, irreducible candidates.

## Decision ledger

- Name the directive `@mutate-equivalent` and pin its complete grammar as `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` on the mutated physical line; rules out reason-only comments, alternate placement, and parser-dependent escaping.
- Match the directive against file, physical line, and full mutation string; rules out per-file, cross-line, and all-mutations-on-one-line suppression.
- Return accepted-site details from the verifier's pass result; rules out downstream logging rescanning source with a second directive parser.
- Treat malformed or mismatched directives as absent and preserve normal mutation testing; rules out fail-open annotations.
- Prefer code restructuring when it cheaply removes redundancy; rules out annotation as the default repair for surviving mutations.

## Acceptance criteria

- [ ] A verifier regression puts `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` on a changed guard, receives a pass with the accepted file, line, mutation, and reason, and fails against the pre-fix verifier that reports the mutation as surviving.
- [ ] Verifier regressions prove a directive naming another mutation does not suppress the candidate and a matching directive does not suppress the same mutation string on another line.
- [ ] Multiple mutation candidates on one annotated line remain independently verified; only the named transform is accepted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — directive name, exact syntax and JSON escaping, colocated-line and exact-site scoping, accepted-site result, and restructure-first ordering.
- `v2/docs/operator-runbook.md` — recovery for a genuine equivalent mutation: restructure cheap redundancy or add the exact directive with a reason; never add a vacuous test.
- `v2/docs/v1-behaviors.md` — record the changed v2 completion-verification behavior.
- `v2/spec/seeds/implement-verifies-mutations-in-loop.md` — replace its reason-only directive placeholder with the pinned exact-mutation directive contract.
