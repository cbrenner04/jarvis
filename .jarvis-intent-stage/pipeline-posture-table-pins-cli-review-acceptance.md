---
name: pipeline-posture-table-pins-cli-review-acceptance
---

# Pipeline posture table stays aligned with workflow CLI review acceptance

## Problem

The pipeline posture table and the workflow CLIs are separate sources for which `(workflow, review-behavior)` combinations exist. Fixing one cell without linking the sources lets a future CLI or table edit reopen the same gap silently.

## Decisions

- One test enumerates every `(base workflow, posture)` cell the pipeline table treats as realizable or unrealizable and compares it to the corresponding CLI/workflow-args acceptance surface for that workflow — rules out hand-fixing a cell without a cross-source guard.
- Realizable cells must be accepted by the CLI surface (including bare `intent` with `debate` and `light`, bare `plan` postures, and `implement` with `light`/`debate`); unrealizable cells must not be constructible as valid pipeline stage postures that the CLI would accept for that workflow — rules out a table-only or CLI-only definition of legality.
- `implement` + `none` remains the only unrealizable workflow posture pair after the intent debate fix — rules out expanding or shrinking unrealizable cells in this slice.

## Acceptance criteria

- [ ] A test fails on baseline if the pipeline realizable set and CLI acceptance diverge for any `(workflow, posture)` cell, and passes when they match.
- [ ] The test covers all nine `(workflow, posture)` cells for `intent`, `plan`, and `implement` against `none`, `light`, and `debate`.
- [ ] Inverting the assertion (treating a known unrealizable cell as CLI-accepted) makes the test fail.

## Documentation updates

- None — operator and architecture tables live in `v2/docs/workflow-runner.md`; this slice adds enforcement only.

## Prerequisites

- Pipeline admission classifies `intent` + `debate` as realizable and `implement` + `none` as unrealizable.
- `workflow-runner.md` documents the corrected posture resolution table against bare presets.
