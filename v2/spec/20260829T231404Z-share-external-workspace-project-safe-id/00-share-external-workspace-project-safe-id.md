# Share external workspace project-safe ID

## Problem

Intent and plan publication privately transform registered project keys before placing `git: false` workspaces and durable output under Jarvis-owned storage. This spec establishes the shared identity for publication only; chained-stage/daemon resolution is a dependent follow-up.

## Decision ledger

- Export one shared `projectSafeId` transform and make publication consume it; rules out retaining an execution-local definition or making a later daemon-resolution change import publication workflow code.
- Preserve the current non-alphanumeric replacement, edge-hyphen trimming, and `project` fallback exactly; rules out relocating existing external workspaces or durable output for registered keys.
- Pin slash-key routing through intent and plan builders, not only through a transform unit test; rules out a shared export that publication does not actually consume.
- Keep v1's `computeProjectSafeId` resolver unchanged: its origin and root fallback semantics are distinct and are not consolidated by this extraction.

## Tasks

- Move `projectSafeId` from `v2/src/execution/publication-workflow-steps.ts` to `shared/project-safe-id.ts` and import that single exported definition into publication.
- Add shared-helper coverage for slash replacement, edge trimming, case preservation, and all-special fallback.
- Add intent publication coverage with a registered slash-containing key and `git: false`, asserting both the intent workspace and external ready-intent path use the transformed key.
- Add plan publication coverage with a registered slash-containing key and `git: false`, asserting both the plan workspace and durable spec path use the transformed key.
- Leave `v1/src/modes/plan/spec-paths.ts` unchanged.
- Run the typecheck and all test surfaces required by the shared-code change.

## Acceptance criteria

- [ ] `shared/project-safe-id.test.ts` pins `org/repo` → `org-repo`, trims edge hyphens, preserves case, and maps an all-special key to `project`.
- [ ] `projectSafeId` has one exported definition in `shared/project-safe-id.ts`; `v2/src/execution/publication-workflow-steps.ts` imports it and contains no private duplicate.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` test `uses project-safe registered keys for Git-disabled intent workspace and durable output` (or equivalent) supplies a registered slash-containing key with `git: false` and pins `~/.jarvis/intent-work/<safeId>/` plus `~/.jarvis/specs/<safeId>/ready-intents`.
- [ ] `v2/src/execution/plan-workflow-steps.test.ts` test `uses project-safe registered keys for Git-disabled plan workspace and durable output` (or equivalent) supplies a registered slash-containing key with `git: false` and pins `~/.jarvis/specs/<safeId>/plans/<name>` for both workspace and durable output routing.
- [ ] `v2/src/execution/intent-workflow-steps.test.ts` — `uses external ready-intents storage when project git is disabled` — stays green.
- [ ] `v2/src/execution/plan-workflow-steps.test.ts` — `keeps Git-disabled ready-intent plans in external storage` — stays green.
- [ ] `v1/src/modes/plan/spec-paths.ts` remains unchanged; v1's existing project-ID resolver is out of scope.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: this extraction preserves operator-facing paths, architecture semantics, and workflow behavior.
