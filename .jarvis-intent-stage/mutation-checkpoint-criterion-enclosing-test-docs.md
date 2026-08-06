---
name: mutation-checkpoint-criterion-enclosing-test-docs
---

# Mutation-checkpoint criteria must name the enclosing test verbatim

Since `mutation-checkpoint-verifier-trust` dropped the all-directives-in-file fallback, `linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's pin title. Loose references ("on the pinned-argv test", "its regression") link nothing and the checkpoint goes `hollow`, blocking completion even when the directive is present and correct.

Plans and authoring guidance do not yet require naming the enclosing test verbatim, so implement runs block on hollow checkpoints for a purely referential reason.

## Decisions

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria MUST require the enclosing test name verbatim (or a linker-matching substring) in every mutation-checkpoint criterion — rules out loose references that go hollow under the no-fallback linker.
- `v2/docs/operator-runbook.md` § Gate trust documents the hollow-on-unnamed-test failure mode and fix (edit the criterion to name the enclosing test verbatim) — rules out operators treating it as a proof-form or directive-syntax problem.
- A doc assertion or lint covers the spec-guidance rule presence — rules out guidance that drifts out of the durable doc without CI signal.
- Out of scope: reintroducing the all-directives-in-file fallback; plan-review hollow-pin flagging (separate intent).

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to name the enclosing test verbatim in the criterion; a doc assertion or lint covers the guidance presence.
- [ ] `bun run typecheck` and the touched test scope pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — name the enclosing test verbatim; loose references go hollow under the no-fallback linker.
- `v2/docs/operator-runbook.md` § Gate trust — hollow-on-unnamed-test failure mode and its fix.

## Prerequisites

- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (no all-directives-in-file fallback).
