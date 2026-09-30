---
name: configure-pipeline-supersede-policy
---

# Pipeline supersede policy resolves at project admission

## Problem

Terminal publication can supersede earlier stage PRs, but no project config knob admits whether that should happen.

## Behavior

`projects.<key>.pipeline.supersede` accepts `"close"` or `"keep"`, defaults `"close"`, and resolution copies the resolved policy onto the immutable admitted pipeline definition. Malformed values fail resolution with a message naming the config path.

## Acceptance criteria

- [ ] `project-pipeline-resolution.test.ts` proves default and explicit values isolate on admitted definitions and rejects malformed values before admission; fails against the baseline.

## Documentation updates

- `v2/docs/install-and-config.md` — policy values, default, validation.
- `v2/docs/v1-behaviors.md` — admitted supersede policy.

## Primary implementation surface

`v2/src/execution/project-pipeline-resolution.ts`

## Prerequisites
