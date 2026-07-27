---
name: pipeline-definitions-and-validation
---

# Source-owned pipeline definitions and admission validation

Slice 1a of [per-project pipelines](../per-project-pipelines-brief.md).

## Prerequisites

- Named workflow presets (`intent`, `plan`, `implement`) are registered in v2 source and resolvable by name
- Review roles resolve to agent/model bindings from the machine profile

## Problem

Nothing in the harness describes "intent → approve → plan → approve → implement" as a
value. Before any execution work, a pipeline needs a definition type and a validator that
rejects a bad definition up front rather than three stages in.

## Decisions

- Definitions live in `v2/src`, keyed by name, exported from one registry. Rules out data-file or config-supplied definitions.
- A stage is either a workflow stage (registered preset name + review posture `none` / `light` / `debate`) or a human-approval stage. Rules out arbitrary stage kinds and per-stage prompts.
- Validation is a pure function over a definition returning a named error, not a throw at first execution. Rules out discovering a typo mid-run.
- Every validation error names the offending stage ID and field. Rules out a generic parse error.

## Acceptance criteria

- [ ] A pipeline definition type exists with stage identity, workflow reference, review posture, and approval-stage kind; unit tests cover each stage kind.
- [ ] A source-owned registry exports at least one named definition; lookup by name is total (hit or named miss).
- [ ] Validation rejects unknown workflow name, invalid review posture, and missing role binding for the resolved posture — one test per case, each asserting the stage ID and field appear in the message.
- [ ] Every registered definition validates clean; a test asserts this over the whole registry.

## Documentation updates

- `v2/docs/workflow-runner.md` — pipeline definitions vs. workflow presets; stage kinds and postures.
