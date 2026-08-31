# Chained implement stage default-branch baseRef

## Problem

`resolveImplementStage` pins `baseRef` to `prior.branch`, stacking chained implement draft PRs on the plan stage branch. Operator directive (2026-08-31): pipeline implement stages target the repository default branch like intent and plan.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts` (`resolveImplementStage`). In-scope: `pipeline-stage-resolve.test.ts`, `pipeline-stage-dispatch.test.ts`, `shared/git.ts` (`getBaseBranch`) as existing helper.

## Decisions

- Chained implement resolved `baseRef` uses `getBaseBranch(context.cwd)` (pipeline admission root) — rules out `baseRef: prior.branch` in `resolveImplementStage` and rules out `getBaseBranch(project.root)` for implement resolution (plan presets keep `project.root`).
- Git-disabled chained implement resolution path is unchanged aside from default-branch `baseRef` — rules out new git-disabled default-branch machinery in this slice.
- `prior.branch` remains for downstream-input rematerialization and durable path walks — rules out folding artifact resolution into this change; preflight spec-availability decoupling is subspec 01.
- Fan-out implement lanes resolve `baseRef` to repository default branch, not lane `prior.branch` — rules out per-lane `plan/beta` stacking retained alongside main-target single-lane pipelines.
- Repository default branch means `getBaseBranch` (`gh repo view`, `main` fallback) — rules out a separate resolver or hard-coded `main`.

## Task checklist

- Replace `baseRef: prior.branch` in `resolveImplementStage` with async `getBaseBranch(context.cwd)`.
- Add regression `chained implement stage resolves baseRef to repository default branch, not prior branch` in `pipeline-stage-resolve.test.ts` with `prior.branch` distinct from default branch.
- Update fake-builder implement resolution tests that expect `prior.branch` as resolved `baseRef` (fan-out `plan/beta` binding; `implement stage threads light review posture`; `implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef`; `pipeline-stage-dispatch.test.ts` handoff `baseRef` when it mirrors resolution output). Real-preset-builder chained implement tests flip in subspec 01.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — `chained implement stage resolves baseRef to repository default branch, not prior branch` drives chained implement resolution and asserts resolved `baseRef` is the repository default branch, not `prior.branch`; it fails against current `baseRef: prior.branch` pinning in `resolveImplementStage` (reachable on main: `implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef` expects `seenInput?.baseRef` to equal `planImplementBranch`).
- [ ] `pipeline-stage-resolve.test.ts` — fan-out implement resolution asserts resolved `baseRef` is the repository default branch, not lane `prior.branch` (`plan/beta`); fails against current `expect(seenInput?.baseRef).toBe("plan/beta")`.
- [ ] `pipeline-stage-resolve.test.ts` — chained implement resolution keeps `prior.branch` for rematerialization while resolved publication `baseRef` is the repository default branch (distinct `prior.branch` fixture; `cwd`/artifact reads still use prior worktree).
- [ ] `pipeline-stage-resolve.test.ts` — `plan stage falls back to prior branch when recorded prior worktree directory is absent` stays green.
- [ ] `pipeline-stage-resolve.test.ts` — `implement stage falls back to prior branch when recorded prior worktree directory is absent` stays green.
- [ ] `pipeline-stage-resolve.test.ts` — `implement stage threads light review posture` stays green with resolved `baseRef` equal to repository default branch.
- [ ] `bun run typecheck` passes.
- [ ] `pipeline-stage-resolve.test.ts` fake-builder chained implement resolution tests and `pipeline-stage-dispatch.test.ts` pass (`implement stage resolves through real preset builders when plan spec exists only on plan worktree branch` completes in subspec 01; full `test:v2` completes in subspec 01).

## Documentation updates

- `v2/docs/pipeline-execution.md` — chained implement stages set worktree/publication `baseRef` to repository default branch, not `prior.branch`; note `prior.branch` remains for artifact rematerialization and preflight spec availability (subspec 01).
