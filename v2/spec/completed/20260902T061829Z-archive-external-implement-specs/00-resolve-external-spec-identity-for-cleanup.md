# Resolve external spec identity for cleanup

## Problem

`sourceForRun` rebases absolute `specPath` values through the implementation worktree and `projectRoot`, so durable standalone and chained implement runs that record an admitted external plan index under `~/.jarvis/specs/<safeId>/plans/<name>/index.md` yield no artifact identity and cleanup skips archival with `no durable spec identity`.

## Decisions

- Reuse admission's external-plan resolver (`resolveExternalPlanSpecIdentity` / `parseExternalPlanSpecPath`), including subspec-path normalization to `plans/<name>/`; rules out a parallel path-shape or walk-up algorithm that diverges from admission.
- Treat the persisted absolute external plan index (or its parent directory when the run recorded a subspec path) as the cleanup source of truth; rules out reconstructing identity relative to the code worktree or repository.
- Identity equality for cleanup (including `recordedStrandedBranch` matching) uses the same canonicalization admission applies (`realpathSync` / resolved-path containment); rules out symlink or canonical-path mismatches between run rows and discovered artifacts.
- Absolute-path identity bypass in `sourceForRun` applies only to paths under `join(jarvisHome(), "specs", projectSafeId(owner), "plans", …)` for exactly one admitted owner whose `planSourcePublishesExternally` predicate is true; rules out treating all absolute `specPath` values as external and regressing the in-repo open-home skip-then-stranded sequence pinned by `"archives open-home spec when retiring its owning worktree in one invocation"`.
- Leave in-repo relative `specPath` resolution unchanged; rules out regressing repository spec cleanup.
- Deferred to first consumer: chained retired-worktree external archival AC — pin when a homestead-shaped fixture exists.

## Tasks

- Extend `sourceForRun` (and any shared helper it calls) to call `resolveExternalPlanSpecIdentity` / `parseExternalPlanSpecPath` for absolute paths so admitted external plan homes resolve to `plans/<name>/` without `relative(worktreePath, …)` or `resolve(projectRoot, …)` rebasing.
- Reuse `projectSafeId` and `planSourcePublishesExternally` for ownership validation; refuse unrecognized or in-repo-only owners the same way admission does.
- Wire the resolved identity through `artifactForRetiredWorktree` and `recordedStrandedBranch` so retired-worktree and stranded flows share one path.
- Add `cleanup.test.ts` coverage for standalone and chained durable runs whose `specPath` is the canonical external index.

## Acceptance criteria

- [x] `cleanup.test.ts` — `"resolves absolute external plan specPath from durable implement run for retired-worktree archival"` archives a completed external plan tree after its owning merged worktree retires when the run row records the canonical external `index.md`; it fails against the pre-fix `sourceForRun` identity filter that returns undefined for absolute paths outside the worktree (reachable on main: `cleanup.ts` `sourceForRun` rejects `isAbsolute(identity)` after `relative(worktreePath, run.specPath)`).
- [x] `cleanup.test.ts` — `"recordedStrandedBranch matches external plan directory from chained implement specPath"` resolves the implementation branch for a discovered external plan artifact from a durable run whose `specPath` is absolute under `plans/<name>/`; it fails against the pre-fix `recordedStrandedBranch` path that never matches external sources.
- [x] `cleanup.test.ts` — `"archives open-home spec when retiring its owning worktree in one invocation"` stays green.
- [x] `cleanup.test.ts` — `"retires and archives the authored spec for a default $name workflow"` stays green.
- [x] `cleanup.test.ts` — `"refuses open-home stranded archival while a materialized owner is not retired"` stays green.
- [x] `cleanup.test.ts` — `"dry-run stranded archive preview matches apply when owning worktree is in retire preview set"` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None — identity resolution is internal to cleanup; operator-visible archival behavior is documented in `03-document-external-plan-archival.md`.
