# 00 - Pipeline posture vs CLI review acceptance alignment test

## Problem

Pipeline admission and `jarvis run workflow` parse acceptance are maintained separately. A fix in one surface can reopen a `(workflow, review posture)` gap in the other without a failing test.

## Prerequisites

- `validatePipelineDefinition` admits `intent` + `debate` and rejects only `implement` + `none` as `unrealizable-review-posture`.
- `v2/docs/workflow-runner.md` documents the `(workflow, review)` resolution table against bare presets and review behavior.
- `parseIntentWorkflowArgs`, `parsePlanWorkflowArgs`, and `parseImplementWorkflowArgs` in `workflow-args.ts` are the CLI admission parsers for bare workflows.

## Decisions

- One file `v2/src/execution/pipeline-posture-cli-alignment.test.ts` with `describe("pipeline posture vs workflow CLI review acceptance")` enumerating all nine `(base workflow, posture)` cells — rules out scattered cross-check tests.
- Export `isUnrealizableWorkflowReview(workflow, review)` from `pipeline-definition.ts`; `validateWorkflowStage` and the alignment test both call it — rules out duplicating the unrealizable matrix or resurrecting the removed `isUnrealizableReview` symbol.
- Posture → CLI review argv mapping: `none` → `--review-passes 0`; `light` → `--review-passes 1 --review-behavior light`; `debate` → `--review-passes 1 --review-behavior debate` on `intent` and `plan`; on `implement`, only `light` and `debate` use that one-pass pair — rules out comparing `implement` + `none` to bare `implement --review-passes 0`, which is CLI-valid but out of band for pipeline posture parity.
- CLI acceptance uses the same parsers as `jarvis run workflow`, with minimal required flags per workflow (`--seed`, `--ready-intent`, or `--base` + `--spec`) plus mapped review flags — rules out ad hoc usage-string tables in the test.
- Realizable cells: `!isUnrealizableWorkflowReview` and mapped argv parses `{ ok: true }`. Unmappable `implement` + `none`: `isUnrealizableWorkflowReview` is true; no CLI argv is built — rules out table-only or CLI-only legality.
- `implement` + `none` stays the sole unrealizable workflow posture pair — rules out expanding or shrinking unrealizable cells in this slice.

## Task checklist

- [ ] Export `isUnrealizableWorkflowReview` from `pipeline-definition.ts` and route the existing `implement` + `none` check through it.
- [ ] Add `pipeline-posture-cli-alignment.test.ts`: iterate `intent` | `plan` | `implement` × `none` | `light` | `debate`; assert pipeline realizability matches CLI parse acceptance under the mapping above.
- [ ] Keep `pipeline-definition-validation.test.ts` green (`"implement under none is unrealizable; light on the same stage validates clean"` unchanged).

## Acceptance criteria

- [ ] `pipeline-posture-cli-alignment.test.ts` is absent pre-fix; `bun test v2/src/execution/pipeline-posture-cli-alignment.test.ts` fails until the file lands and passes when pipeline realizability and CLI acceptance align for all nine cells.
- [ ] The `describe("pipeline posture vs workflow CLI review acceptance")` block covers every `(intent|plan|implement) × (none|light|debate)` cell, including `intent` + `debate` as realizable and `implement` + `none` as unrealizable without a CLI argv mapping.
- [ ] Inverting the `implement` + `none` unrealizable assertion in `pipeline-posture-cli-alignment.test.ts` makes the test fail.

## Documentation updates

- None — operator tables live in `v2/docs/workflow-runner.md`; this slice adds enforcement only.
