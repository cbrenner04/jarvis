# 02 - Optional plan review composition

## Scope

- Make the primary `plan` builder compose no review, light review, or debate review from one option contract.
- Retain both reviewed plan names only as thin compatibility aliases.

## Decisions

- Omitted or zero `reviewPasses` yields the one-step plan workflow; rules out making review implicit on the primary preset.
- Positive passes use `reviewBehavior: "debate" | "light"`, defaulting to `debate`; rules out behavior-specific plan builders.
- `plan-reviewed` delegates with defaults of one debate pass and `plan-reviewed-light` with one light pass; rules out duplicate builders or a silent legacy break.
- Explicit alias options override alias defaults; rules out legacy names pinning a behavior after migration begins.

## Task checklist

- Fold debate/light selection and zero-pass omission into `buildPlanWorkflowSteps`.
- Replace both reviewed-plan implementation surfaces with delegating alias entries.
- Cover canonical and alias composition, bindings, invalid inputs, and unchanged publication identity.
- Update durable workflow and v1-parity documentation.

## Acceptance criteria

- [ ] New `v2/src/execution/plan-workflow-steps.test.ts` cases fail on baseline and verify `plan` omits review for omitted/zero passes and appends the selected light or debate step for positive passes.
- [ ] `plan-reviewed` and `plan-reviewed-light` resolve through the primary plan builder with their existing one-pass behavior defaults, while explicit options override those defaults.
- [ ] Existing plan validation, publication, light-review, and debate-review cases in `v2/src/execution/plan-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document canonical plan builder composition and both compatibility aliases.
- `v2/docs/v1-behaviors.md` — record optional plan review behavior and legacy compatibility.
