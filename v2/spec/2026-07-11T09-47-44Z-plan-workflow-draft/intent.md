---
name: plan-workflow-draft
description: draft-only plan workflow — ready-intent to timestamped spec tree, no review step
---

# `plan` workflow — draft only

Operator drafts a spec tree from a ready-intent via the v2 write loop, no review step.

`jarvis run workflow plan --ready-intent <path> [--target-dir <dir>]`:

- `buildPlanWorkflowSteps`: validate the ready-intent (`name:`, `## Prerequisites`); resolve project from cwd; copy the ready-intent to the spec dir as `intent.md`; branch `plan/<slug>`; timestamped spec dir under `<targetDir>/`.
- Preset `plan`: one `write` step — `role: plan`, `promptId: plan.prompt.draft`; registered on the workflow launcher.
- Prerequisite gate: an unconfirmed prerequisite writes a `## Blocker` to `intent.md`, emits no spec files, and fails the workflow.
- Draft output contract: a passing run lands an `index.md` plus numbered `NN-*.md` subspecs, validated with the shape ported from v1 plan draft.
- Completion publish (commit + draft PR) at the end of the write step.

## Prerequisites

- A generic `jarvis run workflow <name>` preset launcher resolves a preset name to a step builder and rejects unknown presets.
- A v2 `write` step with completion publish (commit + draft PR) exists.
