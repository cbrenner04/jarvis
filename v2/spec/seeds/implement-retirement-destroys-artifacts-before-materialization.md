---
name: implement-retirement-destroys-artifacts-before-materialization
---

# Stale-workspace retirement destroys the worktree and branch before checking materialization can succeed

## Problem

On an incomplete implement re-run, the stale-workspace retirement (preflight gate 4) removes the managed worktree, deletes the local branch, deletes the remote branch, and only *then* rematerializes from `--base`. If rematerialization fails, the branch and worktree are already gone — the run exits `worktree_materialization_failed` and prints a `Retirement destroyed artifacts:` block, but the operator's committed work survives only as unreferenced objects in the store. Retirement is destructive-first, validate-never.

The sharpest case: **`--base` naming the same branch being retired.** Retirement deletes branch `X`, then materialization runs `git branch X X` (recreate `X` from `X`) which fails `fatal: not a valid object name: 'X'` because `X` was just deleted.

Observed 2026-08-16: operator re-ran `jarvis run workflow implement --base 20260816T205749Z-v2-init-command --spec …/index.md` with `--base` == the implement branch (intending to continue committed-but-unmerged subspecs 00/01/02 without merging). Retirement removed the worktree, deleted the local branch, reported the remote already absent, then `git branch <branch> <branch>` failed. The branch tip (`1e393482`, a hand-committed WIP over the completed subspecs) survived only in the object store and was recovered by hand via `git branch <name> <dangling-sha>` after `git fsck`.

## Decisions

- Validate that rematerialization can succeed **before** destroying anything: `--base` must resolve to a real commit, and that commit must not be the branch about to be deleted. On any validation failure, refuse with a clear message and leave the worktree, local branch, remote branch, and PR intact. Rules out today's destroy-then-fail ordering.
- Reject `--base` equal to (or resolving to) the branch being retired as a named pre-mutation refusal, before touching git. Rules out the self-referential `git branch X X` failure.
- When retirement legitimately must destroy artifacts and a later step still fails, the failure output must include the retired branch's **tip SHA** so the operator can `git branch <name> <sha>` without hunting the object store. Today the `Retirement destroyed artifacts:` block lists paths and branch names but not the commit needed to recover.

## Acceptance criteria

- [ ] An incomplete implement re-run whose `--base` resolves to the same branch being retired refuses before any worktree/branch/PR destruction, naming the base==branch collision, pinned by a test.
- [ ] When base validation fails for any reason, retirement destroys nothing — worktree, local branch, remote branch, and any matching PR remain intact — pinned by a test.
- [ ] When retirement does destroy artifacts and a subsequent step fails, the failure output includes the retired branch's tip SHA for recovery, pinned by a test.
- [ ] A successful retirement + rematerialize against a valid distinct base is unchanged, pinned by existing tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the base==branch refusal, the validate-before-destroy guarantee, and how to recover a tip SHA from the failure output.
- `v2/docs/daemon-host.md` / `v2/docs/workflow-runner.md` — retirement ordering: materialization pre-validation runs before any destructive step.
