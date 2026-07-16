# 01 - Optional intent review composition

## Scope

- Make the primary `intent` builder compose no review, light review, or debate review from one option contract.
- Add the governed intent-specific debate prompts required by the first debate consumer.
- Retain `intent-reviewed` only as a thin compatibility alias.

## Decisions

- Omitted or zero `reviewPasses` yields the one-step intent workflow; rules out making review implicit on the primary preset.
- Positive passes use `reviewBehavior: "debate" | "light"`, defaulting to `debate`; rules out separate reviewed builders as implementation surfaces.
- Govern `intent.prompt.review.adversary`, `.advocate`, and `.adjudicator` with staged-intent/spec-guidance boundaries; rules out reusing plan-review prose or the light critic prompt for debate roles.
- The intent review profile renders both review behaviors and retains staging-only actuator enforcement; rules out a generic least-restrictive debate path.
- `intent-reviewed` delegates to `intent`, defaulting only omitted alias options to one light pass; rules out breaking legacy behavior or maintaining duplicate composition logic.

## Task checklist

- Register and render the three intent debate-role prompts through the existing review profile contract.
- Fold light/debate selection and zero-pass omission into `buildIntentWorkflowSteps`.
- Replace the reviewed-intent implementation surface with a delegating alias entry.
- Cover canonical and alias composition, prompt rendering, bindings, and invalid pass/behavior values.
- Update durable prompt, workflow, and v1-parity documentation.

## Acceptance criteria

- [x] New `shared/prompts/review-profile.test.ts` and intent prompt-rendering coverage fails on baseline and verifies governed, fully rendered intent debate prompts plus the intent actuator/boundary profile.
- [x] New `v2/src/execution/intent-workflow-steps.test.ts` cases fail on baseline and verify `intent` omits review for omitted/zero passes and appends the selected light or debate step for positive passes.
- [x] `intent-reviewed` resolves through the primary intent builder, defaults to one light pass, and honors explicit review options without a second builder implementation.
- [x] Existing intent split, light-review, landing, and resume cases in `v2/src/execution/intent-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts` stay green.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/prompts.md` — register intent debate roles, inputs, ordering, and write boundary.
- `v2/docs/workflow-runner.md` — document canonical intent builder composition and the compatibility alias.
- `v2/docs/v1-behaviors.md` — record optional intent review behavior and legacy compatibility.
