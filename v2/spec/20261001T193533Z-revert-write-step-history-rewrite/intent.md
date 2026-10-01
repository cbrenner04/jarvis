---
name: revert-write-step-history-rewrite
---

# Write-step iterations revert agent lane history rewrites

## Problem

A write-step agent can rebase, reset, or amend the lane during an iteration. Ready-repair fence baselines only uncommitted paths, so a rewritten clean tree passes the fence and publication push; the lane's earlier publish is no longer an ancestor of `HEAD` and `resolveLeaseTip` refuses the lane's own tip.

## Decisions

- Record `HEAD` before every write-step agent invocation (implement iterations and ready repair). After the agent returns and before fence, autofix, or commit, when the recorded SHA is not an ancestor of `HEAD`, treat the iteration as a history rewrite.
- On rewrite: `git reset --keep <pre-iteration HEAD>`, log `agent_history_rewrite_reverted` with `fromSha`/`toSha`, then continue the iteration. When `reset --keep` fails, settle resumable `completion_commit_failed` naming both SHAs and push nothing.
- Descendant `HEAD` moves from agent-created commits are not rewrites.
- Publisher lease authorization (`leaseFromSha` only) is unchanged.
- `write-loop-ready-repair.test.ts` is a normal `test:v2` execution test (not `*.sandbox-unrunnable.test.ts`).

## Acceptance criteria

- [ ] `v2/src/execution/iteration-head-guard.test.ts` (new): pre-iteration `HEAD` not an ancestor of post-iteration `HEAD` (temp-repo rebase onto a moved base) restores the pre-iteration SHA and keeps a non-conflicting uncommitted edit; fails against a guard that only checks the working tree.
- [ ] Same file: descendant `HEAD` (agent commit) and unchanged `HEAD` perform no reset and emit no rewrite event.
- [ ] Same file: `reset --keep` conflict yields a failure result naming both SHAs with the branch ref unchanged by the guard.
- [ ] `v2/src/execution/write-loop-ready-repair.test.ts` (new): a ready-repair agent stub that rebases onto a moved base publishes from the pre-iteration lineage (no `ForeignRemoteTipError`) and logs `agent_history_rewrite_reverted`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Ready gate repair — iterations that rewrite lane history revert to pre-iteration `HEAD`.
- `v2/docs/operator-runbook.md` "Foreign tip on a publication push" — agent rewrites as a cause and the `agent_history_rewrite_reverted` event.
- `v2/docs/v1-behaviors.md` — record the history-rewrite guard.

## Primary implementation surface

- `v2/src/execution/`

## Prerequisites
