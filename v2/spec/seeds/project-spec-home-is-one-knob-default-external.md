---
name: project-spec-home-is-one-knob-default-external
---

# A project's spec home is one config knob, defaulting to the external home

## Problem

Where a project's specs live is decided by a side-effect knob, not a location knob. In-repo (`<repo>/<targetDir>`) is the default; the Jarvis-owned external home (`~/.jarvis/specs/<safeId>/`) is opt-in via `plan.commit: false` or `git: false`, with a machine-level `modes.plan.commit` fallback. For a single operator the sensible default is the inverse: only jarvis and dogfood projects (chess, sudoku) want specs committed to the repo; every other project should land externally with no config at all. Today chess and sudoku are in-repo by accident of the default, not by choice.

The decision is also spread out. `join(jarvisHome(), "specs", safeId, …)` is spelled out independently in nine places (`publication-workflow-steps.ts` ×3, `pipeline-stage-resolve.ts` ×2, `implement-workflow-steps.ts`, `pipeline-chained-workflow-deps.ts`, `cleanup.ts` ×2, `cleanup-artifacts.ts`) with no `specsHome()` helper next to `jarvisHome()` in `v2/src/paths.ts`. The in-repo-vs-external predicate exists three times and disagrees: `effectivePublishGit` (intent/plan) and `chainedStageEffectivePublishGit` honor the machine fallback; `planSourcePublishesExternally` (implement admission, cleanup) reads project config only. A project relying on `modes.plan.commit: false` publishes externally but implement does not recognize the spec as external. `install-and-config.md` presents the precedence as universal. `~/.jarvis/intent-work/<safeId>/` is per-project spec scratch living as a sibling of `specs/` with its own duplicated path construction.

## Decisions

- One per-project knob names the location: `projects.<key>.specs: "external" | "repo"` (final name open), default `"external"`. `targetDir` is meaningful only under `"repo"`; `plan.commit`, the `git: false` admission overload, and the machine-level `modes.plan.*` fallback are removed, not aliased. A machine-wide spec-home default has no meaning for one operator.
- `v2/src/paths.ts` owns `specsHome(projectKey)` (and the per-project scratch root); every current `join(..., "specs", ...)` site consumes it. One exported predicate decides in-repo vs external and is the only one implement, cleanup, publication, and pipeline resolution call.
- `intent-work/<safeId>/` moves under the project's external home so per-project artifacts share one root.
- Config migration is the operator's, not a code shim: jarvis, chess-mvp-yolo, chess-mvp-yolo-2, sudoku gain `specs: "repo"`; every `plan.commit: false` entry drops it. Unknown legacy keys fail config validation naming the key.
- Keep the existing external-home layout (`seeds/`, `ready-intents/`, `plans/<name>/`, `plans/completed/`); this seed relocates the decision, not the artifacts.

## Acceptance criteria

- [ ] A project with no `specs` key publishes intent, plan, and implement artifacts to the external home; `specs: "repo"` publishes to `<repo>/<targetDir>`; pinned by tests across intent, plan, implement admission, chained pipeline resolution, and cleanup discovery.
- [ ] `plan.commit`, `git`-as-spec-home, and `modes.plan.commit` are rejected by config validation with a message naming the replacement key; pinned by tests.
- [ ] Exactly one path builder and one predicate remain (a structural test greps `v2/src` for `"specs"` path joins outside `paths.ts`).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — replace the `git`/`plan.commit`/`modes.plan.commit` precedence with the single `specs` key; update the external-home tree for `intent-work`.
- `v2/docs/spec-guidance.md`, `v2/docs/operator-runbook.md` § spec locations, `v2/docs/daemon-host.md` § Git-disabled chained plan artifacts, `v2/docs/first-workflow-walkthrough.md`, `v2/docs/pipeline-execution.md` — reword "Git-disabled / no-commit" to "external spec home".
- `v2/docs/v1-behaviors.md` — record the knob change and the default flip.
