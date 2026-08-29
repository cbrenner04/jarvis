---
name: share-external-workspace-project-safe-id
---

# Share external workspace project identity

## Problem

Intent and plan publication privately transform a registered project key for Jarvis-managed external paths, leaving chained-stage resolution without a reusable definition of the same identity.

## Module-boundary surface

- Execution loop

## Decisions

- Move the project-safe ID transform to shared code consumed by publication; rules out making daemon resolution depend on a publication-workflow implementation detail.
- Preserve the current replacement, trimming, and empty-result fallback behavior; rules out relocating existing git-disabled workspace and durable-output paths.

## Acceptance criteria

- [ ] `projectSafeId` has one exported shared definition consumed by intent and plan publication.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` and `v2/src/execution/plan-workflow-steps.test.ts` pin a registered key containing `/` to the existing transformed `~/.jarvis/intent-work/<safeId>/` and `~/.jarvis/specs/<safeId>/` path segments.
- [ ] Existing git-disabled cases in `v2/src/execution/intent-workflow-steps.test.ts` and `v2/src/execution/plan-workflow-steps.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: this behavior-preserving extraction changes no operator-facing path or workflow semantic.

## Prerequisites
