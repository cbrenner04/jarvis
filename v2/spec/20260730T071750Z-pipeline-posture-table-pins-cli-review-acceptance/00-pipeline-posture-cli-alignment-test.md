# 00 - Pipeline posture vs CLI review acceptance alignment test

## Problem

Pipeline admission (`isUnrealizableWorkflowReview`) and bare-workflow CLI parse acceptance (`parse*WorkflowArgs`) are maintained separately for the nine-cell `(workflow, posture)` matrix. A fix in one surface can reopen a gap in the other without a failing test. Resolver presets, role bindings, and parsed field values are out of scope.

## Prerequisites

- `intent` + `debate` realizable and `implement` + `none` the sole unrealizable pair are pinned upstream (`validatePipelineDefinition` admits/rejects accordingly; `pipeline-definition-validation.test.ts` covers membership).
- `v2/docs/workflow-runner.md` documents the `(workflow, review)` resolution table against bare presets and review behavior.
- `parseIntentWorkflowArgs`, `parsePlanWorkflowArgs`, and `parseImplementWorkflowArgs` in `workflow-args.ts` are the CLI admission parsers for bare workflows.

## Decisions

- One file `v2/src/execution/pipeline-posture-cli-alignment.test.ts` with `describe("pipeline posture vs workflow CLI review acceptance")` enumerating all nine `(base workflow, posture)` cells — rules out scattered cross-check tests.
- Export `isUnrealizableWorkflowReview(workflow, review)` from `pipeline-definition.ts`; `validatePipelineDefinition` admission and the alignment test both call it — rules out duplicating the unrealizable matrix or resurrecting the removed `isUnrealizableReview` symbol.
- Alignment test enforces cross-source consistency given the fixed unrealizable matrix; it does not re-litigate which cells belong in it (upstream validation tests own membership).
- Posture → CLI review argv mapping: `none` → explicit `--review-passes 0` (pipeline-canonical; not flag omission); `light` → `--review-passes 1 --review-behavior light`; `debate` → `--review-passes 1 --review-behavior debate` on `intent` and `plan`; on `implement`, only `light` and `debate` use that one-pass pair — rules out comparing `implement` + `none` to bare `implement --review-passes 0`, which is CLI-valid but out of band for pipeline posture parity.
- Minimal per-workflow argv fixtures: intent satisfies `--seed` / `--seed-text` xor (e.g. `--seed-text` with a literal); plan uses `--ready-intent` with a dummy path; implement uses `--base` + `--spec` with dummy paths — plus mapped review flags.
- Realizable cells: `!isUnrealizableWorkflowReview` and mapped argv parses `{ ok: true }` via the corresponding `parse*WorkflowArgs`. Unrealizable `implement` + `none`: `isUnrealizableWorkflowReview` is true; no CLI argv is built (structural exclusion) — rules out table-only or CLI-only legality.
- `implement` + `none` stays the sole unrealizable workflow posture pair — rules out expanding or shrinking unrealizable cells in this slice.

## Task checklist

- [ ] Export `isUnrealizableWorkflowReview` from `pipeline-definition.ts` and route the existing `implement` + `none` check on the `validatePipelineDefinition` admission path through it.
- [ ] Add `pipeline-posture-cli-alignment.test.ts`: iterate `intent` | `plan` | `implement` × `none` | `light` | `debate`; assert pipeline realizability matches CLI parse acceptance under the mapping above.

## Acceptance criteria

- [ ] `pipeline-posture-cli-alignment.test.ts` passes when pipeline realizability and CLI parse acceptance agree for all nine cells, and fails when they diverge; AC3 invert on `implement` + `none` proves the alignment loop is load-bearing.
- [ ] The `describe("pipeline posture vs workflow CLI review acceptance")` block covers every `(intent|plan|implement) × (none|light|debate)` cell: all eight realizable cells invoke the corresponding `parse*WorkflowArgs` under mapped review flags; `implement` + `none` is unrealizable with no CLI argv construction.
- [ ] Inverting the `implement` + `none` unrealizable assertion in `pipeline-posture-cli-alignment.test.ts` makes the test fail.
- [ ] `pipeline-definition-validation.test.ts` `"implement under none is unrealizable; light on the same stage validates clean"` stays green.

## Documentation updates

- None — operator tables live in `v2/docs/workflow-runner.md`; this slice adds enforcement only.
