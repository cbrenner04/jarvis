---
name: specs-home-path-builder
---

# External spec home paths come from one builder in paths.ts

Behavior-preserving consolidation: `v2/src/paths.ts` exports `specsHome(projectKey)` and the per-project scratch root beside `jarvisHome()`. Every `join(jarvisHome(), "specs", safeId, …)` site (`publication-workflow-steps.ts`, `pipeline-stage-resolve.ts`, `implement-workflow-steps.ts`, `pipeline-chained-workflow-deps.ts`, `cleanup.ts`, `cleanup-artifacts.ts`) consumes it. `intent-work/<safeId>/` moves under the project's external home. External-home layout (`seeds/`, `ready-intents/`, `plans/<name>/`, `plans/completed/`) is unchanged.

## Acceptance criteria

- [ ] A structural test greps `v2/src` and fails on any `"specs"` path join outside `paths.ts`.
- [ ] Intent scratch resolves under the project's external spec home; pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — external-home tree shows `intent-work` under the project home.

## Prerequisites
