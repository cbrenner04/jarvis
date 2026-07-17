# 00 - Route intent output from canonical seeds

## Scope

- Derive committed intent output from canonical file-seed location.
- Preserve explicit, configured, inline, non-canonical, and Git-disabled routing contracts.
- Cover `intent` and `intent-reviewed`.

## Decisions

- A file seed whose direct parent is `<targetDir>/seeds/` selects `<targetDir>/ready-intents/`; rules out configured cross-surface routing for canonical queue input.
- Explicit `--target-dir` precedes seed-derived routing; rules out replacing the per-run override.
- Inline seeds and file seeds outside a direct `seeds/` parent retain configured/default target resolution; rules out inventing a target from non-canonical input.
- Git-disabled intent output remains under Jarvis-owned external storage regardless of seed path; rules out writing no-commit output into the project.
- `intent-reviewed` inherits canonical routing through the primary intent builder; rules out alias-only routing logic.

## Task checklist

- Resolve committed intent target precedence from the explicit override, canonical seed path, configured target, then `spec`.
- Add primary and reviewed-alias routing regressions for v1 and v2 canonical seeds and fallback cases.
- Align durable workflow and parity documentation.

## Acceptance criteria

- [ ] New table-driven cases in `v2/src/execution/intent-workflow-steps.test.ts` fail against the baseline and prove `intent` and `intent-reviewed` route canonical `v1/spec/seeds/` and `v2/spec/seeds/` inputs to the matching `ready-intents/` directory even when configured `plan.targetDir` names the other surface.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` proves explicit `targetDir` wins, while inline and non-canonical file seeds retain configured/default routing.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` proves Git-disabled canonical file seeds retain Jarvis-owned external output.
- [ ] Existing intent builder, review composition, validation, and input-consumption tests stay green: `v2/src/execution/intent-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document intent target precedence and canonical, fallback, override, alias, and Git-disabled output locations.
- `v2/docs/v1-behaviors.md` — record the changed v2 intent routing contract and sources.
