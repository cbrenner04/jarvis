---
name: plan-workflow-write-step-invokes-agent
---

# Plan workflow write steps invoke an agent after iteration_started

`jarvis run workflow plan`, `plan-reviewed`, and `plan-reviewed-light` must spawn an agent subprocess and progress past the first write-loop iteration. Today the structured log records only `iteration_started` indefinitely and no `codex`/`cursor`/`claude` child appears.

## Decisions

- Fix the stall between `iteration_started` and agent spawn — rules out shipping only a timeout workaround.
- Scope all three plan presets — rules out fixing `plan-reviewed-light` alone while leaving `plan`/`plan-reviewed` untested.
- Root-cause by diffing the plan draft write step against the working intent write step under identical machine bindings — rules out a workflow-runner redesign.

## Out of scope

- Redesigning workflow step execution.
- Review/debate steps after the draft write step (failures there are separate).

## Documentation updates

- `v2/docs/workflow-runner.md` — plan draft write-step spawn contract (agent subprocess, session evidence, post-`iteration_started` events).
- `v2/docs/v1-behaviors.md` — plan preset write-step spawn behavior.

## Prerequisites

- Plan workflow presets build a draft write step from a ready intent.
- Intent workflow write step spawns an agent and emits post-`iteration_started` loop events under identical machine bindings.
