# Chain external plan implement dispatch

## Problem

`resolveImplementStage` always sets `preflightGitRoot` / `preflightBaseRef` for default-builder chained implement, so a prior git-disabled plan workspace at `~/.jarvis/specs/<safeId>/plans/<name>/` enters `resolveChainedImplementLaunch` instead of `resolveImplementSpecIdentity`. The chained path runs `isSpecAvailableInBaseRef` against the external plan workspace and never stamps `externalPlanSpec`, `absoluteSpecPath`, or admission-root code routing — even though standalone CLI implement already admits the same tree.

## Decisions

- When chained implement resolves an external plan index under `jarvisHome()/specs/<projectSafeId>/plans/`, normalize to that `index.md` and admit through the shared `resolveImplementSpecIdentity` / `resolveExternalPlanSpecIdentity` contract; rules out a pipeline-only external-spec dispatch path.
- Keep admission-root `projectRoot` / publication `baseRef` for code worktree routing while `specReadRoot` stays on the external `plans/<name>/` tree; rules out `isSpecAvailableInBaseRef` membership checks against the non-Git plan workspace.
- Leave git-enabled chained `preflightGitRoot` / `preflightBaseRef` launches unchanged; rules out altering ordinary plan-worktree handoff semantics.
- Return shared `implement.already_complete` from `buildImplementWorkflowSteps` for a complete external chained tree before workflow load, worktree materialization, or agent creation; rules out daemon-only completion side effects.

## Tasks

- In `resolveImplementStage` (`pipeline-stage-resolve.ts`), detect when `resolveChainedImplementSpecPath` read root is an admitted external plan workspace and build implement input through shared external identity (omit `preflightGitRoot` / `preflightBaseRef`; pass `externalPlanSpec`, `absoluteSpecPath`, `specReadRoot`, admission `projectRoot` / `projectName`, publication `baseRef`).
- If chained launches can still reach `resolveChainedImplementLaunch` with an external plan index, add an external-plan bypass there that reuses `resolveExternalPlanSpecIdentity` and skips base-ref membership; rules out duplicating admission predicates outside the shared helper.
- Strengthen `pipeline-stage-resolve.test.ts` `"implement stage resolves through real preset builders when plan spec exists only on git-disabled plan workspace"` to assert external identity on the resolved write step (`externalPlanSpec`, absolute `specPath` / `expectedArtifactPath`, `specReadRoot`, admission-root `worktree.projectRoot`, publication `baseRef`).
- Add `pipeline-stage-resolve.test.ts` `"chained implement stage returns already_complete for complete git-disabled external plan tree"` with all linked subspec criteria checked and no write-step worktree materialization.
- Keep git-enabled chained normalization, matcher, and settlement coverage green.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — `"implement stage resolves through real preset builders when plan spec exists only on git-disabled plan workspace"` asserts the resolved write step carries `externalPlanSpec: true`, canonical absolute external `specPath` / `expectedArtifactPath`, `specReadRoot` on the `plans/<name>/` directory, admission-root `worktree.projectRoot`, and publication default-branch `worktree.baseRef` rather than `preflightGitRoot` on the plan workspace; it fails against the pre-fix chained launch that omits `externalPlanSpec` (reachable on main: the test currently expects only `result.ok` and a write step).
- [x] `pipeline-stage-resolve.test.ts` — `"chained implement stage returns already_complete for complete git-disabled external plan tree"` returns `implement.already_complete` through real preset preparation without a materialized implement worktree or loaded workflow steps; it fails against the pre-fix chained launch that never reaches shared external completeness admission.
- [x] `pipeline-stage-resolve.test.ts` — `"implement stage resolves through real preset builders when plan spec exists only on plan worktree branch"` stays green.
- [x] `pipeline-stage-resolve.test.ts` — `"implement stage normalizes the recorded plan directory artifact through real preset builders"` stays green.
- [x] `pipeline-stage-resolve.test.ts` — `"implement stage normalizes prior plan directory specPath to index.md"` stays green.
- [x] `implement-workflow-steps.test.ts` — `"chained pipeline preflight uses prior worktree as git root and prior branch for spec availability while publication baseRef is default branch"` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — operator and architecture prose for chained external-plan implement is owned by `01-document-chained-external-plan-implement.md`.

## Blocker

Artifact contract check failed: Unticked non-human-only acceptance criteria:
- `pipeline-stage-resolve.test.ts` — `"implement stage resolves through real preset builders when plan spec exists only on git-disabled plan workspace"` asserts the resolved write step carries `externalPlanSpec: true`, canonical absolute external `specPath` / `expectedArtifactPath`, `specReadRoot` on the `plans/<name>/` directory, admission-root `worktree.projectRoot`, and publication default-branch `worktree.baseRef` rather than `preflightGitRoot` on the plan workspace; it fails against the pre-fix chained launch that omits `externalPlanSpec` (reachable on main: the test currently expects only `result.ok` and a write step).
- `pipeline-stage-resolve.test.ts` — `"chained implement stage returns already_complete for complete git-disabled external plan tree"` returns `implement.already_complete` through real preset preparation without a materialized implement worktree or loaded workflow steps; it fails against the pre-fix chained launch that never reaches shared external completeness admission.
- `pipeline-stage-resolve.test.ts` — `"implement stage resolves through real preset builders when plan spec exists only on plan worktree branch"` stays green.
- `pipeline-stage-resolve.test.ts` — `"implement stage normalizes the recorded plan directory artifact through real preset builders"` stays green.
- `pipeline-stage-resolve.test.ts` — `"implement stage normalizes prior plan directory specPath to index.md"` stays green.
- `implement-workflow-steps.test.ts` — `"chained pipeline preflight uses prior worktree as git root and prior branch for spec availability while publication baseRef is default branch"` stays green.
- `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
