# Match git-disabled chained-stage workspaces

## Primary implementation surface

Daemon: `createChainedStageProjectMatch` in `v2/src/daemon/pipeline-stage-resolve.ts`.

## Problem

Chained plan and implement stages cannot map prior git-disabled stage workspaces back to their registered project because those workspaces live outside both the admission root and `~/.jarvis/worktrees/<key>/`.

## Prerequisites

- `shared/project-safe-id.ts` exports `projectSafeId` and publication routes git-disabled intent workspaces to `~/.jarvis/intent-work/<safeId>/` and git-disabled durable output under `~/.jarvis/specs/<safeId>/plans/<name>/` (`v2/spec/20260829T231404Z-share-external-workspace-project-safe-id`).

## Decision ledger

- Match any path under `~/.jarvis/intent-work/<projectSafeId(key)>/` and `~/.jarvis/specs/<projectSafeId(key)>/` to `{ key, root: admissionRoot }`; rules out threading project identity through persisted stage artifacts.
- Derive each managed-root segment from the registered key via shared `projectSafeId`; rules out duplicating path normalization in daemon code.
- Keep existing `~/.jarvis/worktrees/<key>/` matching and admission-root direct match unchanged; rules out regressing git-enabled chained handoff.
- Preserve the terminal `findProjectMatch` fallback for paths outside recognized managed roots; rules out broad ownership claims for unrelated workspaces.
- Out of scope: external ready-intent CLI `--spec` admission, fan-out lane semantics, and publication path shape changes.

## Tasks

- Import `projectSafeId` from `shared/project-safe-id.ts` into `pipeline-stage-resolve.ts`.
- Extend `createChainedStageProjectMatch` to scan registered keys for `intent-work` and `specs` managed roots under `jarvisHome()` using `projectSafeId(key)` path segments.
- Add `pipeline-stage-resolve.test.ts` matcher coverage for `createChainedStageProjectMatch` (direct matcher calls): intent-work slug path (`intent-work/<safeId>/<slug>`), specs plan workspace path (`specs/<safeId>/plans/<name>/`), slash-containing registered key, git-enabled `worktrees/<key>/` preservation, and multi-project fallback non-claim.
- Isolate `JARVIS_HOME` in new matcher and composed tests via existing helpers so paths align with publication fixtures (`createChainedStageProjectMatch` reads `jarvisHome()` directly).
- Add or extend `"plan stage resolves through real preset builders when ready-intent exists only on git-disabled intent workspace"` so chained plan resolution succeeds when the prior entry-run `worktreePath` is under `intent-work/<safeId>/<slug>` and the ready-intent exists only on that workspace.
- Add `"implement stage resolves through real preset builders when plan spec exists only on git-disabled plan workspace"` so chained implement resolution succeeds when the prior worktree is `specs/<safeId>/plans/<name>/` and the plan spec exists only on that workspace.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` proves a prior path under `~/.jarvis/intent-work/<safeId>/<slug>` resolves through `createChainedStageProjectMatch` to the registered key and pipeline admission `cwd`; it fails against the pre-fix matcher (reachable on main: only `worktrees/<key>` is recognized).
- [x] `pipeline-stage-resolve.test.ts` proves a prior path under `~/.jarvis/specs/<safeId>/plans/<name>/` resolves through `createChainedStageProjectMatch` to the registered key and admission `cwd`; it fails against the pre-fix matcher.
- [x] `pipeline-stage-resolve.test.ts` registers a key containing `/` and proves both git-disabled managed-root families resolve through its `projectSafeId` segment (for example `Org/Repo` → `Org-Repo` under `intent-work/` and `specs/`); it fails against the pre-fix matcher.
- [x] `pipeline-stage-resolve.test.ts` proves a path under `jarvisHome()/worktrees/<key>/` still resolves to `{ key, root: admissionRoot }`; it fails if git-enabled worktree matching regresses.
- [x] `pipeline-stage-resolve.test.ts` — multi-project setup where the query path is `findProjectMatch`-able for one registered project but not under any registered managed root (`worktrees/`, `intent-work/`, `specs/`) for any key — proves the matcher returns the same result as bare terminal `findProjectMatch` with no managed-root override; it fails if managed-root matching incorrectly claims that path.
- [x] `pipeline-stage-resolve.test.ts` — `"plan stage resolves through real preset builders when ready-intent exists only on git-disabled intent workspace"` exercises chained plan resolution through real preset builders when the prior worktree is a git-disabled intent workspace; it fails against the pre-fix matcher.
- [x] `pipeline-stage-resolve.test.ts` — `"implement stage resolves through real preset builders when plan spec exists only on git-disabled plan workspace"` exercises chained implement resolution through real preset builders when the prior worktree is `specs/<safeId>/plans/<name>/`; it fails against the pre-fix matcher.
- [x] `pipeline-stage-resolve.test.ts` — `"plan stage resolves through real preset builders when ready-intent exists only on intent worktree"`, `"implement stage resolves through real preset builders when plan spec exists only on plan worktree branch"`, and `"implement stage normalizes the recorded plan directory artifact through real preset builders"` stay green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — document chained-stage `createChainedStageProjectMatch`: admission-root direct match; git-enabled `~/.jarvis/worktrees/<key>/` (raw registered key); git-disabled `~/.jarvis/intent-work/<project-safe-id>/` and `~/.jarvis/specs/<project-safe-id>/` (`projectSafeId` segment); all map to `{ key, root: admissionRoot }` where `root` is pipeline admission `cwd` (not necessarily registry `project.root`); use `ready-intents/` and `plans/<name>/` examples consistent with publication; paths outside those roots keep the `findProjectMatch` fallback.
- `v2/docs/v1-behaviors.md` — add a `[v2 additive]` bullet recording the same three managed-root families and returned `root` semantics for chained-stage resolution.
