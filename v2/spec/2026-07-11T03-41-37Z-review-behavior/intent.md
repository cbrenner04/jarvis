---
name: review-behavior
---

# Lightweight review behavior

Add the `review` workflow primitive: each cycle runs a read-only critic, writes its output to the verdict file, then gives a non-empty verdict verbatim to the actuator. An empty verdict skips the actuator and ends the loop; otherwise cycles continue through `maxCycles`.

Expose `critic` as a distinct executable role with independent `(agent, critic) -> rungs` resolution. Dispatch programmatic `behavior: "review"` steps through the workflow runner with per-role critic and actuator fallback orders, quota fallthrough, `complete` / `invocation_failure` outcome mapping, and no durable mid-cycle resume.

Cover empty verdict termination, actuator skipping, critic or actuator failure mid-cycle, role-specific binding resolution, and quota fallthrough for both roles with co-located tests.

## Decisions

- Implement a dedicated review executor; rules out a short-panel flag on `executeReviewDebate` because review has no debate roles.
- Bind `critic` independently from `adversary`; rules out sharing critique-model rungs across distinct review behaviors.
- Reuse the `actuator` role; rules out a review-specific actuator role because verdict application has the same resolution contract.
- Keep review runtime-only and non-resumable; rules out workflow-loader support and durable mid-cycle state before a caller requires them.

## Prerequisites

## Out of scope

- Workflow-loader support for non-write steps.
- Workflow presets and intent, plan, or implement prompts.
- Phase 9 routing.

## Documentation updates

- `v2/docs/role-resolution.md` — add `critic` and the `review` role/behavior mappings.
- `v2/docs/workflow-runner.md` — document programmatic `review` dispatch, binding resolution, outcomes, and resume limits.
- `v2/docs/write-behavior.md` — document or cross-link the review cycle in its single durable home.
