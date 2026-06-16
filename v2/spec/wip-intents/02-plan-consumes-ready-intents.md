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
