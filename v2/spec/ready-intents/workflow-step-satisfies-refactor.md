---
name: workflow-step-satisfies-refactor
---

# Drop the defineWorkflowStep identity wrapper

## Problem

`defineWorkflowStep` (`v2/src/execution/workflow-runner.ts:138`) is `(step) =>
step` — an identity function whose only job is the type annotation. Its one
production caller and its test callers can express the same type check with
`satisfies`.

## Direction

Delete `defineWorkflowStep`; callers annotate with `satisfies WorkflowStepInput`
(or the concrete step type) instead.

## Decisions

- Remove the wrapper rather than keep it for call-site brevity — rules out
  treating a same-object passthrough as worth a named export.

## Prerequisites
