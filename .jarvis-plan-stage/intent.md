---
name: verify-directive-only-mutation-criteria
---

# Verify directive-only mutation criteria

The fix touches one module-boundary surface, the execution loop, so splitting does not apply.

## Module-boundary surface

- Execution loop: mutation-checkpoint criterion selection and verification.

## Problem

- Ticked criteria quoting `@mutate` without `Mutation checkpoint:` bypass verification silently.

## Decisions

- Select ticked non-human criteria containing either `Mutation checkpoint:` or `@mutate`; rules out phrase-only admission.
- Give directive-selected criteria the existing resolve/apply/scoped-red contract; rules out a weaker directive-only path.
- Preserve directive syntax, resolution, phrase-selected behavior, and scoped-run lifecycle; rules out expanding this fix into verifier redesign.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` proves a ticked directive-only criterion is refused with `path:line` coordinates when its mutation leaves the scoped suite green and accepted when the mutation turns the suite red; the regression fails against the pre-fix selector.
- [ ] `mutation-checkpoint-verifier.test.ts` proves phrase-only prose with no linked directive remains refused.
- [ ] `mutation-checkpoint-verifier.test.ts` proves a criterion containing neither marker remains ignored, including prose using the word “mutation.”
- [ ] Mutation checkpoint: the directive-only regression carries a `// @mutate` directive targeting the real criterion-selection guard and reverting it to phrase-only selection; its pin turns RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust: selection keys on the phrase or a quoted directive.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria: state the same authoring contract.
- `v2/docs/v1-behaviors.md`: record the changed v2 completion-verification behavior.

## Prerequisites

- The execution-loop verifier links `// @mutate` directives from named pinning tests, applies them to real source, runs classified scoped suites, refuses surviving mutations, and restores source.
