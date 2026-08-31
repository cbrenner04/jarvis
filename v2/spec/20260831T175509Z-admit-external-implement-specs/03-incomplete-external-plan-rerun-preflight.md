# Incomplete external plan re-run preflight

An incomplete external plan re-run must pass implement build preflight, reach the ordinary stale code-worktree reset gates, and skip landed-criteria drift rooted at the external spec without treating the external tree as repository or worktree content.

## Decisions

- Apply incomplete re-run stale-workspace reset to the resolved `(project, branch)` code worktree exactly as for in-repo specs once build preflight succeeds; rules out skipping reset because the spec lives externally.
- Skip landed-criteria drift collection (or re-root it to `specReadRoot`) when `maybeResetStaleWorkspace` receives an admitted external write step whose `specPath` is the external-absolute `absoluteSpecPath` from `01`; rules out worktree-relative resolution refusing reset after successful build preflight.
- Do not copy, symlink, or resolve the external spec tree into the materialized code worktree during admission or build preflight; rules out false `implement.link_out_of_tree` or missing-spec refusals caused by worktree-relative lookup.
- Keep the source external spec tree intact across reset teardown; rules out treating external indexes as abandon targets.

## Tasks

- Branch stale-reset landed-criteria handling on `externalPlanSpec` / external-absolute write-step `specPath` the same way `01` branches base-ref membership.
- Drive incomplete external implement preflight through production `buildImplementWorkflowSteps` so the write step carries external-absolute `specPath`.
- Add a `workflow.test.ts` regression that reaches `maybeResetStaleWorkspace` with a stale code worktree and production-shaped external `specPath`.
- Assert the external index and subspec files remain on disk across reset orchestration.

## Acceptance criteria

- [x] `workflow.test.ts` drives an incomplete external plan re-run through production implement build into `maybeResetStaleWorkspace` with a stale code worktree and write-step `specPath` as the external-absolute path from `01`; it fails against the pre-fix landed-criteria refusal reachable when drift collection resolves `specPath` relative to the code worktree.
- [x] `workflow.test.ts` `implement preflight stale workspace reset` stays green (in-repo stale-reset landed-criteria unchanged).
- [x] `workflow.test.ts` proves the stale-workspace reset orchestrator runs for an incomplete external plan re-run while the external index and subspec files remain on disk; it fails against the pre-fix `implement.link_out_of_tree` or missing-spec refusal reachable before reset.

## Documentation updates

- Deferred to `04-document-external-plan-implement-admission.md` for operator-facing rerun prose.
