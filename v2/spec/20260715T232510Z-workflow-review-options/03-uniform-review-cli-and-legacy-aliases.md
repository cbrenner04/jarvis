# 03 - Uniform review CLI and legacy aliases

## Scope

- Expose `--review-passes <n>` and `--review-behavior debate|light` on the three primary workflow commands.
- Route legacy reviewed names through their canonical commands with migration guidance.
- Align operator documentation to the canonical commands.

## Decisions

- `intent`, `plan`, and `implement` accept the same review flag names and validation; rules out preset-specific CLI option contracts.
- Primary commands default omitted passes to their builder/config result and omit review when the resolved count is zero; rules out a zero-cycle review step.
- Legacy reviewed names remain accepted, emit one terse stderr migration hint naming the canonical command, and otherwise use the same parser/dispatch path; rules out silent removal or permanent parallel CLI surfaces.
- Legacy aliases accept both review flags, with explicit values overriding alias defaults; rules out aliases becoming incompatible dead ends.
- Invalid pass counts and behaviors fail with the selected command's usage before daemon contact; rules out builder or daemon discovery of CLI syntax errors.

## Task checklist

- Generalize workflow argument parsing and usage generation around the three canonical preset shapes.
- Normalize legacy names to canonical builder dispatch while applying their compatibility defaults and emitting migration guidance.
- Add CLI coverage for all primary commands, zero/positive passes, both behaviors, invalid values, aliases, and pre-daemon failure.
- Replace reviewed-name walkthrough examples and align the durable command catalog.

## Acceptance criteria

- [ ] New `v2/src/cli.test.ts` cases fail on baseline and verify each of `intent`, `plan`, and `implement` accepts both review flags, forwards zero without a review step, and selects light or debate for positive passes.
- [ ] Invalid `--review-passes` or `--review-behavior` values on every primary preset exit `1` with usage before daemon contact.
- [ ] `intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` still launch their compatible canonical workflows and emit a terse migration hint naming `intent` or `plan` plus the corresponding review behavior.
- [ ] Unknown workflow names list only `intent`, `plan`, and `implement` as primary presets while legacy aliases remain recognized.
- [ ] Existing `v2/src/cli.test.ts` workflow start/wait, exit-code, and implement launch cases stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — update the preset table, uniform flags, alias mappings/hints, and canonical CLI examples.
- `v2/docs/first-workflow-walkthrough.md` — use canonical intent, plan, and implement commands with optional review flags.
- `v2/docs/v1-behaviors.md` — record the three primary names, uniform option contract, zero-pass omission, aliases, and migration guidance.
