---
name: intent-workflow-reviewed
---

# Review staged intents before landing

Add the v2-native `intent-reviewed` workflow. It splits a seed into staged
ready-intents, runs light critic/actuator review over that staged output, then
lands and publishes only the reviewed files.

## Decisions

- `intent-reviewed` composes split then light `review`; rules out `review-debate` for intent fan-out.
- `--review-passes` defaults to `1`, and `0` selects split-only `intent` behavior; rules out requiring a separate builder or running a zero-cycle review step.
- The review verdict is a sibling of `.jarvis-intent-stage/`, not durable ready-intent output; rules out landing reviewer control data under `ready-intents/`.
- Register governed `intent.prompt.review` and `intent.prompt.review-actuator` artifacts; rules out reusing plan-review prose or embedding intent review instructions in code.
- `intent-reviewed` is the v2 default intent posture while `intent` remains explicit split-only parity; rules out silently changing the existing `intent` preset.

## Prerequisites

- The v2 `review` behavior runs critic and actuator cycles and receives per-role workflow bindings.
- The v2 `intent` workflow stages, validates, transactionally lands, and publishes authored ready-intents.
- The v2 workflow launcher dispatches registered named preset builders.

## Scope

- Add and govern intent-specific critic and actuator-context prompts.
- Extend the intent builder with explicit review-pass selection and a verdict path beside staging.
- Compose and register the `intent-reviewed` split-plus-review preset.
- Preserve split-only execution when review passes are zero.
- Verify reviewed output alone reaches durable `ready-intents/` and existing publication behavior.

## Out of scope

- Human approval after intent review.
- Plan workflow review.
- Debate review for intents.

## Documentation updates

- Update `v1/docs/prompt-governance.md` with both intent review prompt IDs.
- Update `v2/docs/prompts.md` with intent review prompt ownership and layering.
- Update `v2/docs/workflow-runner.md` with `intent` versus `intent-reviewed`, review-pass selection, verdict placement, and default posture.
- Update `v2/docs/first-workflow-walkthrough.md` with the reviewed intent operator path.

## Observable outcomes

- Launching `intent-reviewed` with the default review-pass count runs split, one light review cycle, then lands reviewed intents.
- `--review-passes N` runs at most `N` light review cycles; `--review-passes 0` performs the existing split-only intent workflow.
- Critic and actuator invocations use the registered intent-specific governed prompts and their configured role bindings.
- Review failure or non-completion prevents staged intents from landing or publishing.
- Successful git-enabled and git-disabled runs retain the existing intent workflow destinations and publication semantics.
