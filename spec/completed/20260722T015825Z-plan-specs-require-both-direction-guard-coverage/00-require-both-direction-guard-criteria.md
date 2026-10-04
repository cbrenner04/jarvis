# Require both-direction guard criteria

Plan-drafted code changes can satisfy stated effects while leaving inverse guard behavior unpinned, then fail completion mutation verification.

## Decisions

- Add one standing acceptance criterion to every subspec whose tasks or criteria change executable code, including mixed code-and-docs work; rules out planner-specific guard enumeration and classifying mixed work as docs-only.
- Omit the standing criterion when every task and criterion changes only documentation or spec prose; rules out unconditional boilerplate.
- Require tests to fail when each added or modified guard is inverted, with suppressed effects proved absent in the negative direction; rules out happy-path-only coverage.
- Change planning guidance only and preserve completion mutation verification; rules out weakening the downstream gate.

## Tasks

- Update the registered plan-draft prompt and revisioned rendered fixture with the conditional standing criterion.
- Drive the production plan draft step with code-touching and docs-only ready-intent fixtures.
- Align durable workflow and spec-authoring documentation.

## Acceptance criteria

- [x] A plan draft gives every code-touching subspec one acceptance criterion requiring tests to fail when each added or modified guard is inverted.
- [x] The standing criterion requires the negative case to prove an effect suppressed by a guard is absent.
- [x] A plan draft gives documentation-only and spec-only subspecs no both-direction guard criterion.
- [x] `v2/src/execution/plan-workflow-steps.test.ts` drives the production draft write step with code-touching and docs-only ready intents, covers both classification branches and the suppressed-effect obligation, and fails against the pre-change prompt.
- [x] Existing plan output shape and standing requirements remain unchanged; `shared/prompts/plan-draft.test.ts` and the revisioned `plan.prompt.draft` rendered snapshot stay green.
- [x] `v2/docs/workflow-runner.md`, `v1/docs/spec-guidance.md`, and `v2/docs/v1-behaviors.md` document the conditional criterion and both-direction contract.
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails; when a guard suppresses an effect, the negative case proves the effect is absent.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — conditional plan-step guard criterion and negative-direction contract.
- `v1/docs/spec-guidance.md` — code-changing acceptance criteria pin guards in both directions.
- `v2/docs/v1-behaviors.md` — plan-generated code-change criteria require both guard directions.
