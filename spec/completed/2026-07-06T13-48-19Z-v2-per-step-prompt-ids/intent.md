---
name: v2-per-step-prompt-ids
---

# Write workflow steps declare their own prompt id

Write workflow steps hardcode `write.execute`. A step should declare which registry prompt id to render, so presets can reuse `plan.*`/`patch.*` artifacts without new code paths.

## Decisions

- `WriteWorkflowStep` (and `WriteLoopInput`) carries optional `promptId: string`; defaults to `write.execute` when omitted.
- `renderWriteExecutePrompt` is replaced by a `renderStepPrompt(promptId, placeholders)` built on `shared/prompts/render.ts`'s `renderArtifactTemplate`.
- Placeholders stay the existing step/run context (`SPEC_PATH`, `STEP_RULES`, `PRINCIPLES`, etc.).
- Workflow runner passes each write step's `promptId` through to `executeWriteLoop`/`executeWrite`.
- Review-debate and human steps are unchanged.

## Out of scope

- Authoring new plan/patch prompt bodies.
- NL `operator` role prompts.
- TUI prompt picker.

## Prerequisites

- Shared prompt registry (`shared/prompts/registry.ts`) and `renderArtifactTemplate` (`shared/prompts/render.ts`) exist.
- Workflow runner executes linear write steps with per-step metadata (`v2/src/execution/workflow-runner.ts`).
