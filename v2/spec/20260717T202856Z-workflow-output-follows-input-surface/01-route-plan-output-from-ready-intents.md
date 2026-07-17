# 01 - Route plan output from ready-intents

## Scope

- Derive committed plan output from canonical ready-intent location.
- Preserve explicit and Git-disabled routing contracts.
- Cover `plan`, `plan-reviewed`, and `plan-reviewed-light`.

## Decisions

- A validated `<targetDir>/ready-intents/<name>.md` input selects `<targetDir>/<timestamp>-<name>/`; rules out configured cross-surface routing for canonical queue input.
- Explicit `--target-dir` precedes ready-intent-derived routing; rules out replacing the per-run override.
- Git-disabled plan output remains under Jarvis-owned external storage regardless of ready-intent path; rules out writing no-commit output into the project.
- Both plan review aliases inherit input routing through the primary plan builder; rules out alias-specific target selection.

## Task checklist

- Resolve committed plan target precedence from the explicit override, validated ready-intent path, configured target, then `spec`.
- Add primary and review-alias routing regressions for v1 and v2 ready-intents, override, and Git-disabled cases.
- Align durable workflow and parity documentation.

## Acceptance criteria

- [x] New table-driven cases in `v2/src/execution/plan-workflow-steps.test.ts` fail against the baseline and prove `plan`, `plan-reviewed`, and `plan-reviewed-light` route `v1/spec/ready-intents/` and `v2/spec/ready-intents/` inputs to timestamped trees under the matching target even when configured `plan.targetDir` names the other surface.
- [x] `v2/src/execution/plan-workflow-steps.test.ts` proves explicit `targetDir` wins over ready-intent routing.
- [x] `v2/src/execution/plan-workflow-steps.test.ts` proves Git-disabled ready-intents retain Jarvis-owned external plan output.
- [x] Existing plan builder, review composition, validation, and input-consumption tests stay green: `v2/src/execution/plan-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document plan target precedence and canonical, override, alias, and Git-disabled output locations.
- `v2/docs/v1-behaviors.md` — record the changed v2 plan routing contract and sources.
