# Remove unreachable plan-review critic arm

## Problem

The shared v1 review runner admits only `adversary`, `advocate`, and `adjudicator`, but `v1/src/modes/plan/review.ts` exposes a fourth `critic` role and selects `plan.prompt.review.critic`. Only v1 rendered-snapshot coverage reaches that arm; the governed critic prompt remains live for v2 light plan review.

## Decision ledger

- Type v1 plan prompt rendering to the shared `ReviewRole` debate union and remove critic selection — rules out v1-local role drift from the runner that supplies the value.
- Remove only v1 critic snapshot pins and their orphan fixtures; retain `plan.prompt.review.critic` and its v2 renderer — rules out breaking v2 light plan review while pruning the unreachable v1 path.
- Preserve v2 ownership with `shared/prompts/review-profile.test.ts` rendering and `v2/src/execution/plan-workflow-steps.test.ts` registry/light-step coverage — rules out treating v1 snapshot removal as prompt retirement.
- Amend the existing review-flow entry in `v2/docs/v1-behaviors.md` — rules out duplicate durable retirement records.
- Scope v1 critic negative greps to `v1/src` and `v1/test`, excluding `v1/spec/**`, `v2/spec/**`, `**/completed/**`, `.jarvis-plan-stage/**`, and Git history — rules out false failures from retained specifications, archives, staging, or history.

## Tasks

- Align `buildReviewPrompt` in `v1/src/modes/plan/review.ts` with `ReviewRole` and remove the critic prompt-id branch.
- Add a compile-time regression in `v1/test/modes/plan/prompts.test.ts` that rejects `role: "critic"` against the v1 builder.
- Remove the critic revision/key/render/assert pins from `v1/test/prompts/rendered-snapshots.test.ts` and delete its orphan historical critic fixtures.
- Strengthen `shared/prompts/review-profile.test.ts` with an explicit critic-render assertion, and `v2/src/execution/plan-workflow-steps.test.ts` with its registry and positive light-review wiring assertion.
- Amend the existing review-flow entry in `v2/docs/v1-behaviors.md` to distinguish v1 debate-only rendering from v2 light-review critic ownership; do not add a separate retirement entry.
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:integration:v1`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared`.

## Acceptance criteria

- [x] `v1/src/modes/plan/review.ts` accepts the shared `ReviewRole` union and contains no `plan.prompt.review.critic` selection; the pre-fix branch in that file is reachable.
- [x] `v1/test/modes/plan/prompts.test.ts` rejects `role: "critic"` with a compile-time regression whose unused-error directive fails against the pre-fix builder signature.
- [x] `rg -n 'plan\.prompt\.review\.critic|role: "critic"|criticKey' v1/src v1/test` returns no matches; this searches only the stated production/test corpus, excluding `v1/spec/**`, `v2/spec/**`, `**/completed/**`, `.jarvis-plan-stage/**`, and Git history, and the pre-fix v1 source/snapshot pins match.
- [x] No files match `v1/test/fixtures/prompts/rendered/plan.prompt.review.critic@r*.shared.txt`; the orphan fixtures exist on the pre-fix base.
- [x] `shared/prompts/review-profile.test.ts` explicitly renders `plan.prompt.review.critic`, and `v2/src/execution/plan-workflow-steps.test.ts` proves the prompt remains registered and wired for positive v2 light plan review; both stay green after the v1 removal.
- [x] The existing review-flow entry in `v2/docs/v1-behaviors.md` identifies v1 plan review as debate-role-only and retains v2 light-review critic ownership without a duplicate retirement entry.
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:integration:v1`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — amend the existing review-flow entry to distinguish v1 debate-role rendering from v2 light-review critic ownership.
