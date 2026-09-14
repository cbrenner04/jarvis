---
name: project-specs-config-key
---

# Project config names the spec home with one `specs` key, rejecting legacy keys

`projects.<key>.specs: "external" | "repo"` is the only spec-home knob, default `"external"`; `targetDir` is meaningful only under `"repo"`. Config validation rejects `plan.commit`, `git` used as spec home, and machine-level `modes.plan.commit`, naming the replacement key. No alias or shim; operator migrates config (jarvis, chess-mvp-yolo, chess-mvp-yolo-2, sudoku gain `specs: "repo"`).

## Acceptance criteria

- [ ] Config parsing yields `external` when `specs` is absent and `repo` when set; pinned by tests with explicit config fixtures.
- [ ] `plan.commit`, `git`-as-spec-home, and `modes.plan.commit` fail validation with a message naming `specs`; pinned by tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — replace the `git`/`plan.commit`/`modes.plan.commit` precedence with the `specs` key.
- `v2/docs/v1-behaviors.md` — record the knob change and default flip.

## Prerequisites

- `v2/src/paths.ts` exports `specsHome(projectKey)` and every external spec path is built through it.
