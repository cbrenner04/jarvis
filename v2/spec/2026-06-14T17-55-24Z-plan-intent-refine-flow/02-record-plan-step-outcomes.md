# Record plan step outcomes

Plan telemetry records intent as its own phase and stores per-step outcomes for intent/refine attempts so refine skip and blocker rates are queryable directly.

## Decisions

- Add `plan_phase: "intent"`, ruling out classifying intent draft as inline, name-only, or refine telemetry.
- Store an outcome field on intent/refine rows, ruling out reconstructing outcomes from row counts or spec text.
- Use outcome values `success | refined | skip | blocker` for successful intent/refine terminal states, ruling out overloading `refined` for intent success.
- Omit or null outcome on failed attempts consistently with the existing telemetry row shape, ruling out failure-only free-form values.
- Leave draft/review telemetry semantics unchanged, ruling out broad summary churn outside intent/refine reporting.
- Preserve compatibility for existing plan telemetry summaries and JSONL consumers, ruling out updating only terminal summaries.

## Tasks

- Extend plan telemetry types in `v1/src/telemetry.ts` and `v1/src/modes/plan/plan-telemetry.ts`.
- Emit `plan_phase: "intent"` for intent-draft agent attempts.
- Populate outcome on intent and refine rows after validation determines refined, skip, or blocker state.
- Define failed-attempt outcome shape (omitted or null) and keep it consistent across intent/refine.
- Update run summary and any scripts/reports that read plan JSONL rows only as needed to accept the new phase/outcome without regressing existing output.
- Add focused telemetry tests for intent phase rows and refine outcome rows.

## Acceptance criteria

- [ ] Intent-draft agent attempts write telemetry rows with `mode: "plan"` and `plan_phase: "intent"`.
- [ ] Intent/refine telemetry rows include outcome `refined`, `skip`, or `blocker` when the phase reaches one of those states.
- [ ] Intent success uses outcome `success`; refine success uses `refined`; skips and blockers use `skip`/`blocker`; failed attempts omit or null outcome consistently.
- [ ] Refine skip is queryable from telemetry without comparing row counts.
- [ ] Existing draft/review telemetry rows, plan summaries, and JSONL-consuming scripts/reports keep their current behavior except for accepting the new phase/outcome fields.
- [ ] Tests cover intent phase telemetry, success outcome, refined outcome, skip outcome, blocker outcome, failed-attempt outcome shape, summary compatibility, and any updated JSONL consumers.

## Documentation updates

- Update `v1/docs/plan-mode.md` usage summary and telemetry sections for `plan_phase: "intent"` and outcome values.
- Update `v2/docs/v1-behaviors.md` plan telemetry catalog entries.
