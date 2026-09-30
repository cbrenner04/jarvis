---
name: non-pipeline-preset
---

# Preset registry marks standalone-only workflows

## Problem

Every workflow preset is pipeline-composable today; a review-feedback re-entry must never appear as a pipeline stage.

## Behavior

The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value. Pipeline definition validation rejects any stage whose `workflow` names a preset marked standalone-only, with a named validation error distinct from `unknown-workflow`.

## Acceptance criteria

- [x] A regression test fails against the pre-fix validator and proves a pipeline definition whose stage `workflow` is a registered standalone-only preset is rejected with a named error while `intent`, `plan`, and `implement` stages remain valid.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — standalone-only preset eligibility versus pipeline stage workflows.

## Prerequisites
