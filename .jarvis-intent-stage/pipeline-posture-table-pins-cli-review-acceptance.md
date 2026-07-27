---
name: pipeline-posture-table-pins-cli-review-acceptance
---

# Pipeline posture table stays aligned with workflow CLI review acceptance

## Problem

The pipeline posture table and the workflow CLIs are separate sources for which `(workflow, review posture)` combinations exist. Fixing one cell without linking the sources lets a future CLI or table edit reopen the same gap silently.

## Decisions

- One test file `v2/src/execution/pipeline-posture-cli-alignment.test.ts` with a `describe("pipeline posture vs workflow CLI review acceptance")` block enumerates all nine `(base workflow, posture)` cells — rules out anonymous or scattered cross-check tests.
- Pipeline posture `none` | `light` | `debate` maps to CLI review args as `reviewPasses: 0` | `reviewPasses: 1` + `reviewBehavior: "light"` | `reviewPasses: 1` + `reviewBehavior: "debate"` on bare `intent` and `plan`; on `implement`, only `light` and `debate` postures map to the same one-pass behavior pair — rules out comparing pipeline `implement` + `none` to bare `implement --review-passes 0`, which is CLI-valid but out of band for pipeline posture parity.
- The canonical pipeline realizability set is derived from `isUnrealizableReview` (or a single exported helper colocated with `pipeline-definition.ts` that both validation and the test import); the canonical CLI acceptance check reuses the same `parseIntentWorkflowArgs` / `parsePlanWorkflowArgs` / `parseImplementWorkflowArgs` paths `workflow-args.ts` uses for `jarvis run workflow` — rules out duplicating usage strings or ad hoc per-workflow tables in the test.
- Realizable cells must parse clean through the CLI parsers with the mapped args; unrealizable cells must not appear as admitted pipeline postures that the CLI would accept under that mapping — rules out a table-only or CLI-only definition of legality.
- `implement` + `none` remains the only unrealizable workflow posture pair after the intent debate fix — rules out expanding or shrinking unrealizable cells in this slice.

## Acceptance criteria

- [ ] `pipeline-posture-cli-alignment.test.ts` fails on baseline when pipeline realizability and CLI acceptance diverge for any of the nine cells, and passes when they match.
- [ ] The test covers every `(intent|plan|implement) × (none|light|debate)` cell, including `intent` + `debate` as realizable and `implement` + `none` as unrealizable.
- [ ] Inverting the assertion for a known unrealizable cell (`implement` + `none`) makes the test fail.

## Documentation updates

- None — operator and architecture tables live in `v2/docs/workflow-runner.md`; this slice adds enforcement only.

## Prerequisites

- Pipeline admission classifies `intent` + `debate` as realizable and `implement` + `none` as unrealizable.
- `v2/docs/workflow-runner.md` documents the corrected posture resolution table against bare presets and review behavior.
