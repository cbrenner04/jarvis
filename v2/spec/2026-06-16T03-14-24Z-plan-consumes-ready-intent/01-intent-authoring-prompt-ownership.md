# Intent-authoring prompt ownership

## Problem

Removing plan-owned intent draft/refine leaves prompt ownership stale. Intent
authoring prompts and docs should belong to `jarvis1 intent`; plan should keep
only spec draft/review prompts.

## Decisions

- `intent-draft` and plan-initial `refine` are removed from plan runtime and prompt registry surfaces -- rules out keeping dead plan prompt IDs for compatibility.
- Intent authoring behavior belongs to `jarvis1 intent` or shared intent-mode helpers, not duplicated under plan -- rules out two prompt copies drifting.
- Plan keeps review-actuator prompts and behavior -- rules out treating all pre-run review as intent-mode scope.
- Prompt snapshot fixtures change only for prompt ownership/rendering changes required by this behavior -- rules out broad snapshot churn.
- Deferred to first consumer: whether later prerequisite enforcement gets its own prompt or pure runtime check -- pin when seed 03 implements enforcement.

## Task checklist

- [ ] Move, share, or retire plan-owned `intent-draft` and initial `refine` prompt/runtime surfaces so fresh plan no longer loads or exposes them.
- [ ] Keep `prompts/plan/draft.md`, review role prompts, review actuator, and plan PR-description behavior wired for the collapsed plan flow.
- [ ] Update prompt registry/governance entries and rendered prompt fixtures to match the new ownership.
- [ ] Ensure intent-mode docs describe where raw-seed authoring/refinement now lives when plan docs point operators there.
- [ ] Add or update tests proving fresh plan does not render/execute the removed plan intent-authoring prompts.

## Acceptance criteria

- [ ] Fresh `jarvis1 plan <ready-intent-file>` does not load, render, snapshot, or execute plan-owned `intent-draft` or initial `refine` prompts.
- [ ] Prompt registry and prompt-governance docs list only active plan prompt IDs for plan behavior; intent-authoring prompts are owned by `jarvis1 intent` or a shared intent surface with no duplicate plan copy.
- [ ] Plan draft/review/review-actuator prompt snapshots reflect the ready-intent input model and still include sentinel-delimited intent data plus spec guidance.
- [ ] `v1/docs/intent-mode.md` is consistent with plan docs about raw-seed authoring being handled before plan.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/prompt-governance.md`: active prompt ownership and registry entries.
- `v2/docs/prompts.md`: prompt ownership/relocation notes if affected.
- `v1/docs/intent-mode.md`: raw-seed authoring handoff referenced by plan docs.
