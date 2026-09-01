# v1 verdict actuator layout variants

`buildVerdictActuatorPrompt` in `v1/src/modes/plan/verdict-actuator.ts` applies the same flat/nested `.replace` / `.replaceAll` surgery as plan draft on `plan.prompt.review-actuator`.

## Decisions

- Declare `TARGET_DIR:string!` and the shared `flat-layout` / `nested-target-dir` variants on `prompts/plan/review-actuator.md`; resolve through `renderArtifactTemplate` — rules out post-render `.replace` in `verdict-actuator.ts`.
- Reuse the plan-draft variant selection contract and `TARGET_DIR` binding — rules out a separate verdict-only variant catalog.
- Preserve trailing-newline normalization (`template.endsWith("\n")`) after render — rules out changing actuator prompt termination bytes.

## Tasks

- Add `TARGET_DIR` and layout variants to `prompts/plan/review-actuator.md`; bump `revision`.
- Route `buildVerdictActuatorPrompt` through `renderArtifactTemplate`; drop pre-render `.replace` calls.

## Acceptance criteria

- [ ] `v1/test/modes/plan/prompts.test.ts` stays green.

## Documentation updates

- None. Rendered actuator prompt bytes unchanged.
