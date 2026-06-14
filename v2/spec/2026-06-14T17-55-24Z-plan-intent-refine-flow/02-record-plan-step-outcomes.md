# Record plan step outcomes

Plan telemetry records intent as its own phase and stores per-step outcomes for intent/refine attempts so refine skip and blocker rates are queryable directly.

## Decisions

- Add `plan_phase: "intent"`, ruling out classifying intent draft as inline, name-only, or refine telemetry.
- Store an outcome field on intent/refine rows, ruling out reconstructing outcomes from row counts or spec text.
- Use outcome values `refined | skip | blocker`, ruling out free-form outcome strings.
- Leave draft/review telemetry semantics unchanged, ruling out broad summary churn outside intent/refine reporting.

## Tasks

- Extend plan telemetry types in `v1/src/telemetry.ts` and `v1/src/modes/plan/plan-telemetry.ts`.
- Emit `plan_phase: "intent"` for intent-draft agent attempts.
- Populate outcome on intent and refine rows after validation determines refined, skip, or blocker state.
- Update run summary handling only as needed to ignore or display the new phase/outcome without regressing existing summaries.
- Add focused telemetry tests for intent phase rows and refine outcome rows.

## Acceptance criteria

- [ ] Intent-draft agent attempts write telemetry rows with `mode: "plan"` and `plan_phase: "intent"`.
- [ ] Intent/refine telemetry rows include outcome `refined`, `skip`, or `blocker` when the phase reaches one of those states.
- [ ] Refine skip is queryable from telemetry without comparing row counts.
- [ ] Existing draft/review telemetry rows and plan summaries keep their current behavior except for accepting the new phase field.
- [ ] Tests cover intent phase telemetry, refined outcome, skip outcome, blocker outcome, and summary compatibility.

## Documentation updates

- Update `v1/docs/plan-mode.md` usage summary and telemetry sections for `plan_phase: "intent"` and outcome values.
- Update `v2/docs/v1-behaviors.md` plan telemetry catalog entries.
