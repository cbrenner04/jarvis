---
name: v2-per-step-prompt-ids
---

# Per-step prompt id on write workflow steps

Today every write step hardcodes `write.execute` (`v2/src/execution/write-prompt.ts`). Workflow steps should declare which prompt artifact to render so presets can use `plan.*`, `patch.*`, etc. without new code paths per workflow.

## Decisions

- **Write workflow steps carry `promptId: string`** — registry id from `prompts/` (same contract as `prompts.md` / `loadPromptRegistry`).
- **Rendering:** replace `renderWriteExecutePrompt` hardcode with `renderStepPrompt(promptId, placeholders)` using existing `shared/prompts/render.ts`. Placeholders remain step/run context (`SPEC_PATH`, `STEP_RULES`, `PRINCIPLES`, etc.); document required placeholders per prompt id at the call site or in `prompts.md`.
- **`write.execute` stays the default** when `promptId` omitted — backward compatible for CLI single-step `jarvis write` and tests.
- **Workflow runner** passes each write step's `promptId` into `executeWriteLoop` / `executeWrite`. Review-debate and human steps unchanged in this slice (review-debate already has per-role prompts on its input type).
- **No new prompt artifacts required** in this slice unless a preset seed needs one — wiring the seam is the deliverable; `implement` preset may follow in a sibling spec.
- **Tests:** at least one workflow test proves step one and step two can use different `promptId` values and receive distinct rendered prompt text (injected registry or snapshot).

## Out of scope

- Authoring new plan/patch prompt bodies.
- NL `operator` role prompts (Phase 9).
- TUI prompt picker.

## Prerequisites

- Shared prompt registry and `renderArtifactTemplate` exist.
- Workflow runner executes linear write steps with per-step metadata.

## Ordering

05 — after shrink pre-work 01–04; before 07 (the implement preset consumes the `promptId` seam).
