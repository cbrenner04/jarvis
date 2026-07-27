---
name: pipeline-definition-schema-and-validation
---

# Pipelines: definition schema, source-owned presets, admission validation

Slice 1 of [per-project pipelines](../per-project-pipelines-brief.md). No prerequisite.

## Problem

A project has no way to declare "intent → approve → plan → approve → implement". Every multi-stage
sequence today is the operator retyping `jarvis run workflow …` per stage and remembering the order.
Before any execution work, the harness needs a validated definition of what a pipeline *is*.

## Decisions

- Pipeline definitions live in source (`v2/src`), keyed by name; `~/.jarvis/config.json` selects a
  named pipeline per project and supplies composition + review posture only. Rules out
  project-supplied prompts or executable stage code — config stays data.
- A stage references a registered workflow preset (`intent`, `plan`, `implement`) plus a review
  posture (`none` / `light` / `debate`), or is a human-approval stage. Rules out arbitrary stage
  kinds.
- Validation runs before admission and rejects: unknown workflow name, invalid review posture,
  missing role bindings for the resolved posture, impossible terminal action. Rules out discovering
  a typo three stages in.
- Validation failure is a named operator error naming the offending stage and field. Rules out a
  generic parse error.

## Acceptance criteria

- [ ] A pipeline definition type exists with stage identity, workflow reference, review posture, and
      approval-stage kind; unit tests cover each stage kind.
- [ ] Config selection resolves a project to a named source-owned pipeline; an unknown name is a
      named error, not a crash or silent default.
- [ ] Validation rejects unknown workflow, invalid posture, missing role binding, and impossible
      terminal action — one test per case, each naming the stage and field in the message.
- [ ] Validation runs before anything is admitted or materialized; a test asserts no run row,
      worktree, or agent invocation for an invalid definition.
- [ ] Config carrying stage prompts or executable code is rejected by validation.

## Documentation updates

- `v2/docs/install-and-config.md` — pipeline selection keys and an example.
- `v2/docs/workflow-runner.md` — pipeline definitions vs. presets; what config may and may not set.
