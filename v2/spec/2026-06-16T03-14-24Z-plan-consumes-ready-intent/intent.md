---
name: plan-consumes-ready-intent
---

## Raw seed

<details>
<summary>Raw seed</summary>

<<<RAW_SEED_BEGIN>>>
# Plan consumes a ready-intent

**Scope.** v1 harness work — `prompts/**`, `v1/**`, docs. Lives in
`v2/spec/wip-intents/` for routing.

**Ordering.** Second of three (01 → 02 → 03). Depends on seed 01's behavior:
`jarvis intent` emits intents into `ready-intents/`. This is the first worked
example of a behavior prerequisite — until enforcement exists (seed 03), the
dependency is honored by filename order.

## Problem

With intent authoring pulled into the new `jarvis intent` mode (seed 01),
`plan`'s first phases (`intent-draft`, `refine`) are now dead weight inside
`plan`. `plan` should become a clean 1:1 function: one ready-intent → one spec
→ one PR.

## Desired behavior

- Drop `intent-draft` and `refine` from `plan`. `plan` now **consumes a
  ready-intent** rather than a raw seed.
- The phase shape collapses to: **draft spec → review/update → spec PR**.
- `plan` reads the consumed ready-intent's `Prerequisites` section but does
  **not** enforce it yet (declared, operator-honored — enforcement is seed 03).

## Decisions

- `plan` consumes ready-intents only; raw-seed authoring lives in `jarvis
  intent`. No dual-path back-compat — a single operator migrates the workflow.
- `intent-draft.md` / `refine.md` prompts move to (or are shared with) the
  `jarvis intent` mode rather than being duplicated.

## Documentation updates

- `v1/docs/plan-mode.md`: the collapsed phase shape; `plan` consumes a
  ready-intent.
- `v2/docs/v1-behaviors.md`: the updated plan-mode flow.

## Out of scope

- Prerequisite enforcement (seed 03).
- Any change to `run` / patch mode.

<<<RAW_SEED_END>>>

</details>

## Intent

# Plan consumes a ready-intent

## Summary

Update v1 plan mode so it starts from an authored ready-intent, not from a raw
seed. Intent authoring belongs to `jarvis1 intent`; plan mode should consume one
ready intent and produce one spec PR.

Scope is v1 harness work: `prompts/**`, `v1/**`, and docs. Do not change patch
mode.

## Prerequisites

- Seed 01 has landed: `jarvis1 intent` writes reviewed intents to
  `ready-intents/`.
- Prerequisite enforcement is not implemented yet. This dependency is declared
  here and honored by filename/order only until seed 03 lands.

## Problem

Plan mode still owns raw-seed cleanup and intent refinement. That duplicates the
new intent mode and leaves plan with extra phases that no longer match its job.

The desired shape is simpler:

```text
ready-intent -> draft spec -> review/update -> spec PR
```

Plan should read the ready intent, including its `Prerequisites` section, but
only carry that context into drafting for now. It should not enforce
prerequisites in this change.

## Desired behavior

- Fresh `jarvis1 plan <path>` accepts an authored ready-intent file and no longer
  runs plan-owned `intent-draft` or `refine` phases.
- Plan still creates the plan worktree/branch, draft PR, spec tree, review
  passes, commits, attribution, telemetry, quota fallback, and ready transition
  according to the existing plan-mode contracts.
- The first agent phase is spec drafting. It receives the consumed intent and
  the spec guidance, then writes `index.md` plus numbered subspecs.
- The review/update loop operates on the generated spec files as it does today.
- Ready-intent `Prerequisites` content is passed through as drafting context but
  is not blocked, validated, or enforced.

## Decisions

- No dual-path compatibility for raw seeds in plan mode. This is a single-user
  workflow migration.
- Inline raw text belongs to `jarvis1 intent`, not `jarvis1 plan`, after this
  change.
- Plan-owned prompt/runtime surfaces for `intent-draft` and initial `refine`
  should move to, or be shared with, intent mode rather than remain duplicated
  under plan.
- Keep review-actuator behavior in plan; this change removes the pre-draft
  intent-refinement phase, not spec review.

## Acceptance signals

- `jarvis1 plan` consumes a ready-intent file and enters spec drafting without
  producing `plan: intent` or `plan: refine` commits.
- Raw-seed/inline plan inputs no longer take the old plan authoring path; docs
  point operators to `jarvis1 intent` first.
- Existing plan draft/review tests are updated or replaced to cover the collapsed
  flow and the non-enforced `Prerequisites` pass-through.
- Prompt fixtures and prompt docs reflect the new ownership of intent authoring
  prompts.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` with the ready-intent input model and collapsed
  phase shape.
- Update `v1/docs/spec-guidance.md` where it still says fresh plan runs author
  intents from raw seeds.
- Update `v2/docs/v1-behaviors.md` so the parity catalog records the changed
  plan-mode behavior.
- Update prompt docs if prompt ownership or fixture coverage changes.

## Out of scope

- Prerequisite enforcement.
- Patch mode / `jarvis1 run`.
- A compatibility shim for old raw-seed plan runs.

## Refinement

- Copy the ready-intent into the generated spec directory as `intent.md`; do not move, delete, or archive the source ready-intent, because destructive consumption belongs with later prerequisite/work-queue enforcement.
- Fresh committed `jarvis1 plan <ready-intent>` runs draft, review, and ready transition in one invocation; do not preserve the old `plan: intent`/`plan: refine` PR handoff or require `--resume-draft`, because those phases leave plan owning removed intent-authoring workflow.
- Derive plan/spec naming from ready-intent frontmatter `name:`; do not run name-only fallback or infer from source filename, because intent authoring already finalized the name.
