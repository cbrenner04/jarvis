---
name: full-light-review-pipeline
---

# Add a `full-light-review` pipeline: the full gated structure with light review

## Problem

The pipeline registry (`v2/src/execution/pipeline-registry.ts`) has two definitions at opposite ends:

- `full-review` — intent(light) → approve-intent → plan(**debate**) → approve-plan → implement(**debate**), terminalAction `ready`. Full approval gates and the four-role debate on plan and implement — the most thorough and the most expensive/slowest.
- `fast` — intent(none) → plan(none) → implement(light), terminalAction `merge`. No gates, minimal review — cheap and quick.

Nothing sits between them: a pipeline that keeps `full-review`'s **full structure** — both approval gates and a review pass at every workflow stage — but runs **light** review instead of debate, for meaningfully lower cost/latency while still gating and reviewing. Operator ask (2026-08-29, down-the-line).

## Decisions

- Add a `full-light-review` entry to `PIPELINE_REGISTRY`: intent(light) → approve-intent → plan(**light**) → approve-plan → implement(**light**), terminalAction `ready`. Same stage/gate shape as `full-review`, `debate` swapped for `light` on plan and implement; rules out dropping the approval gates (that is what `fast` is for).
- Selectable like the others via a project's `pipeline.name` in `~/.jarvis/config.json` and resolvable through `getPipelineDefinition`; rules out a definition reachable only in code.
- Validate under the existing `validatePipelineDefinition` / `isUnrealizableWorkflowReview` rules — `light` is already realizable on intent/plan/implement, so no new posture work; rules out coupling this to any new review type.

## Acceptance criteria

- [ ] `getPipelineDefinition("full-light-review")` returns a definition whose stages are intent(light), approve-intent, plan(light), approve-plan, implement(light) with terminalAction `ready` — pinned by a registry test.
- [ ] The definition passes `validatePipelineDefinition` and its terminal-action/implement-stage checks (mirrors `full-review`) — pinned by a test.
- [ ] A project configured `pipeline.name: "full-light-review"` resolves it through `resolveProjectPipeline` — pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` / the pipeline docs — list `full-light-review` alongside `full-review` and `fast`, describing it as the fully-gated, light-review middle tier.
