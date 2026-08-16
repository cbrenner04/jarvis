---
name: configure-pipeline-supersede-policy
---

# Configure pipeline supersede policy before admission

## Prerequisites

## Problem

Project pipeline config cannot choose whether successful terminal settlement closes preceding stage PRs.

## Decisions

- `projects.<key>.pipeline.supersede` accepts `"close"` or `"keep"` and defaults to `"close"`; rules out a per-start CLI flag and opt-in close behavior.
- Project-pipeline resolution copies the resolved policy onto the immutable admitted definition; rules out rereading mutable config during settlement.
- Malformed or unknown values fail project-pipeline resolution with the full config path before daemon connection; rules out ignoring invalid policy.

## Acceptance criteria

- [ ] `project-pipeline-resolution.test.ts` fails against the baseline, then proves absent policy resolves to `"close"`, explicit `"close"` and `"keep"` remain isolated on admitted definitions, and source definitions stay unchanged.
- [ ] `project-pipeline-resolution.test.ts` rejects malformed and unknown policy values before admission with `projects.<key>.pipeline.supersede` named.

## Documentation updates

- `v2/docs/install-and-config.md` — values, default, validation, and complete project example.
- `v2/docs/workflow-runner.md` — immutable admitted supersede policy.
- `v2/docs/v1-behaviors.md` — v2 pipeline supersede-policy admission.
