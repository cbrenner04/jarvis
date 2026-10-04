---
name: plan-reviewed-light
---

# Draft plans with a light review cycle

## Problem

The `plan` preset drafts a spec tree but offers no composed light-review path.

## Direction

Add `jarvis run workflow plan-reviewed-light --ready-intent <path>`.
It drafts with the existing plan setup, then, when `--review-passes N` is
positive, runs `review` for N critic-actuator cycles over the draft. Zero
passes produces the same draft-only workflow as `plan`.

The review step uses separate critic and actuator bindings, an editorial
`plan.prompt.review.critic`, the existing `plan.prompt.review-actuator`, and
persists its verdict at `<spec-dir>/verdict-plan.md`.

## Decisions

- `plan-reviewed-light` is a separate preset — rules out hiding the composed review step behind a `plan` flag.
- The critic prompt is editorial — rules out reusing the debate adversary prompt.
- `--review-behavior` is fixed to `light` for this preset — rules out selecting debate behavior through this surface.

## Documentation updates

- `v1/docs/prompt-governance.md` — register and govern `plan.prompt.review.critic`.
- `v2/docs/first-workflow-walkthrough.md` — operator usage, pass count, draft-only zero-pass behavior, and verdict location.
- `v2/docs/workflow-runner.md` and `v2/docs/v1-behaviors.md` — preset composition and CLI surface.

## Prerequisites

- The plan workflow builds and publishes a draft spec tree from a ready intent
- The workflow loader validates and dispatches critic-actuator review steps
- The review behavior runs critic-actuator cycles with a durable verdict
