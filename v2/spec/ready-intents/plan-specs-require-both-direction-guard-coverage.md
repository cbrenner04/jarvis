---
name: plan-specs-require-both-direction-guard-coverage
---

# Require both-direction guard coverage in planned code changes

## Problem

- Plan-authored criteria prove intended effects but routinely omit the inverse guard behavior required by completion mutation verification.

## Outcome

- Every planned subspec scoped to executable code requires tests that pin each added or changed guard in both directions, including suppressed effects.
- Documentation-only and spec-only subspecs omit that criterion.

## Decisions

- Add one standing criterion per code-touching subspec; rules out relying on implementers to infer the mutation gate contract or planners to enumerate future guards.
- Require positive and negative directions, naming absence of a suppressed effect; rules out happy-path-only interpretations.
- Treat a subspec as code-touching when any task or acceptance criterion requires changing executable code; mixed code-and-docs subspecs are code-touching. Omit the criterion only when all work is documentation or spec prose; rules out ambiguous classification and unconditional boilerplate.
- Preserve the mutation gate unchanged; rules out bypassing or weakening enforcement.

## Acceptance criteria

- [ ] A plan run over a code-touching ready intent gives every executable-code subspec a criterion requiring tests to fail when any added or modified guard is inverted.
- [ ] The standing criterion explicitly requires the negative case: when a guard suppresses an effect, a test proves the effect is absent.
- [ ] A plan run over a documentation-only ready intent emits no both-direction guard criterion.
- [ ] Regression coverage drives the plan step with code-touching and docs-only ready intents and fails against the prior prompt behavior.
- [ ] Existing plan output structure and other standing criteria remain unchanged.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — conditional plan-step guard criterion and negative-direction contract.
- `v1/docs/spec-guidance.md` — code-changing acceptance criteria pin guards in both directions.
- `v2/docs/v1-behaviors.md` — plan-generated code-change criteria require both guard directions.

## Prerequisites
