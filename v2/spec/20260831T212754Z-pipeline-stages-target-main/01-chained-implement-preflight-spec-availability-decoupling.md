# Chained implement preflight spec-availability decoupling

## Problem

`resolveChainedImplementLaunch` couples chained implement preflight to `input.baseRef` via `isSpecAvailableInBaseRef(specReadRoot, input.baseRef, …)`. After subspec 00, publication/worktree `baseRef` is the repository default branch while plan specs exist only on `prior.branch`; preflight fails without an explicit second ref.

## Surface

Primary: `v2/src/execution/implement-workflow-steps.ts` (`resolveChainedImplementLaunch`, `isSpecAvailableInBaseRef` call sites). In-scope: `implement-workflow-steps.test.ts`, `pipeline-stage-resolve.test.ts` (`implement stage resolves through real preset builders when plan spec exists only on plan worktree branch`), `pipeline-workflow-preparation-parity.test.ts` when it encodes chained implement `baseRef` for preflight.

## Prerequisites

- Subspec 00 landed: chained implement resolved `baseRef` is repository default branch.

## Decisions

- Two-ref model: publication/worktree/ready-gate `baseRef` stays repository default branch; chained spec-availability preflight reads `prior.branch` (or explicit chained bypass when already validated) — rules out continuing to pass publication `baseRef` into `isSpecAvailableInBaseRef` for chained launches.
- Preflight git root stays `preflightGitRoot` / prior worktree — rules out moving spec reads to admission root default branch.
- Subspec 00 rematerialization decision is unchanged — rules out folding preflight decoupling into `resolveImplementStage`.

## Task checklist

- Decouple chained implement preflight from publication `baseRef` in `implement-workflow-steps.ts` (dedicated preflight ref or chained bypass).
- Add or update regression `chained pipeline preflight uses prior worktree as git root and prior branch for spec availability while publication baseRef is default branch` in `implement-workflow-steps.test.ts`.
- Flip `implement stage resolves through real preset builders when plan spec exists only on plan worktree branch` to expect default-branch resolved `baseRef` while resolution still succeeds.
- Update `pipeline-workflow-preparation-parity.test.ts` chained handoff expectations when they mirror preflight `baseRef`.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` — `chained pipeline preflight uses prior worktree as git root and prior branch for spec availability while publication baseRef is default branch` (or successor) asserts `git cat-file` spec-availability uses `prior.branch` while `input.baseRef` is the repository default branch; fails against current `isSpecAvailableInBaseRef(..., input.baseRef, …)` coupling (reachable on main: `chained pipeline preflight uses prior worktree as git root and prior branch as baseRef` passes `baseRef: planBranch` and expects cat-file on `planBranch:spec`).
- [ ] `pipeline-stage-resolve.test.ts` — `implement stage resolves through real preset builders when plan spec exists only on plan worktree branch` stays green with resolved `baseRef` equal to repository default branch, not `prior.branch`.
- [ ] `pipeline-workflow-preparation-parity.test.ts` stays green when it encodes chained implement preflight/baseRef expectations.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — two-ref model prose is owned by subspec 00 (`pipeline-execution.md` implement detail) and subspec 03 (cross-stage summary).
