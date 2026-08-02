# State human-only markers in shared step rules

## Problem

`DEFAULT_WRITE_STEP_RULES` omits the human-only marker contract. It is shared by v1 patch and by
the v2 intent, plan, legacy write, and implement write flows, so treating it as implement-only
would leave other rendered prompts unpinned.

## Decisions

- Add the same marker text, case-insensitive substring recognition, full-bullet scope, and free
  placement contract to `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts`.
- Cover each rendered consumer: v1 patch `patch.prompt.body` and `patch.prompt.shrink`; v2 legacy
  `write.execute` and workflow implement `patch.prompt.body` / `patch.prompt.shrink`; v2 workflow
  intent `intent.prompt.split`; and v2 workflow plan `plan.prompt.draft` step completion. Patch body
  and shrink share the same `STEP_RULES` binding, so one isolated body regression plus existing
  shrink wholesale coverage is sufficient for that pair.
- Pin the bounded `STEP_RULES` injection or supplied `stepRules` value, with marker-free values for
  other injections (e.g. marker-free `specGuidance` when pinning `plan.prompt.draft` step completion).
  Wholesale `toContain(DEFAULT_WRITE_STEP_RULES)` and unscoped whole-prompt checks are insufficient.
- Refresh affected shared-rules rendered fixtures without prompt-template revision bumps. No parser
  or guard changes are in scope.

## Tasks

- Extend `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` with the human-only contract.
- Add source-attributable rendered checks for the shared rules on every listed write flow and refresh
  affected rendered fixtures.
- Update durable write and parity guidance.
- Run the shared-surface verification required below.

## Acceptance criteria

- [ ] Rendered `patch.prompt.body` coverage in `v2/src/execution/write.test.ts` fails against the
      pre-change rules and passes after its isolated `STEP_RULES` section independently names
      `(Manual)`, `visual inspection only`, and `no automated guard`, case-insensitive substring
      recognition, and free placement anywhere in the full bullet block.
- [ ] `v2/src/execution/write-prompt.test.ts` fails against the pre-change rules and passes after an
      isolated `write.execute` `STEP_RULES` render independently pins the same contract. The legacy
      write and workflow-implement input-builder tests in `v2/src/execution/write-loop-input.test.ts`
      and `v2/src/execution/implement-workflow-steps.test.ts` retain their default-rule bindings to this
      shared constant.
- [ ] `v1/test/prompt.test.ts` and `v1/test/prompts/rendered-snapshots.test.ts` pin the v1 patch
      body and refreshed fixture text from the shared rules, with the focused assertion scoped to
      `STEP_RULES` rather than another patch injection.
- [ ] `shared/prompts/intent-split.test.ts` and `shared/prompts/plan-draft.test.ts` independently
      pin the isolated shared-rules text in `intent.prompt.split` and `plan.prompt.draft` step
      completion; use marker-free `specGuidance` on the plan-draft case. Together with
      `v2/src/execution/intent-workflow-steps.test.ts` and
      `v2/src/execution/plan-workflow-steps.test.ts` retaining their default-rule bindings, this
      covers the v2 workflow intent and plan consumers.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe the shared write-step
      contract and its v1 patch plus v2 intent, plan, legacy write, and implement consumers,
      consistently with the parser's existing full-bullet, case-insensitive substring classification.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `DEFAULT_WRITE_STEP_RULES` human-only authoring contract.
- `v2/docs/v1-behaviors.md` — v1 patch and v2 intent, plan, legacy write, and implement flows
  expose the shared marker and placement semantics.
