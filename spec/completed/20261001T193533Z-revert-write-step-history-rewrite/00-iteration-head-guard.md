# Iteration head guard module and awaitIteration wiring

## Problem

After a write-step agent returns on the settled path, fence/autofix/commit run against whatever `HEAD` is. A rebase or reset that drops the lane's published ancestry passes a clean-tree fence and breaks publication lease checks even though uncommitted edits look fine.

## Decision ledger

- Add `v2/src/execution/iteration-head-guard.ts` (git seam + pure ancestor check + `reset --keep` orchestration); rules out inlining only in ready-repair or only in `executeWrite` (implement and ready repair must share one hook).
- Record `git rev-parse HEAD` immediately before `executeWrite` in `awaitIteration`; run detect/revert only when the invocation settles (`QuiescedExecutionOutcome` kind `settled`) — after `executeWrite` returns and before callers run reprompt autofix, fence validation, or iteration commit — when pre-iteration SHA is not an ancestor of post-iteration `HEAD`, treat as history rewrite; rules out guarding interrupted outcomes (`threw`, watchdog/abort loss, gate refusal, ready-repair `unsettled`) or detecting rewrite only from porcelain or staged paths.
- Hook sits after `executeWrite` returns; contract reprompts and in-`executeWrite` autofix that run while the agent still holds a temporarily rewritten `HEAD` are out of scope — rules out moving the hook before in-step contract handling without new ACs.
- Skip the guard for `promptId` `write.mutation-repair` (`awaitIteration` with `"finalization-repair"` for publication mutation repair); guard implement iterations (`"bounded"`) and `write.ready-repair` only — rules out silently guarding mutation repair when intent names only implement and ready repair.
- On rewrite: `git reset --keep <preSha>`, append log event `agent_history_rewrite_reverted` with `fromSha` (post-agent `HEAD`) and `toSha` (pre-iteration SHA), then continue the iteration — rules out aborting the iteration or leaving rewritten history in place.
- When `reset --keep` fails, the guard returns a failure result naming both SHAs with the branch ref unchanged from before the reset attempt — rules out force-moving the branch on conflict; loop mapping to resumable `completion_commit_failed` without push is out of scope for this subspec (unit AC proves the guard result only).
- Agent-created commits where pre-iteration SHA remains an ancestor of post-iteration `HEAD` are not rewrites — rules out treating every new commit as rewrite.
- `completion-publisher` `leaseFromSha` / `resolveLeaseTip` authorization unchanged — rules out widening lease to `ORIG_HEAD` or remote tip alone.

## Task checklist

- Implement `iteration-head-guard.ts` and wire record/check/revert into `awaitIteration` in `write-loop.ts` on the settled post-`executeWrite` path shared by implement iterations and `runReadyRepairIteration`, with the `write.mutation-repair` exclusion.
- Extend `log-stream.ts` (and append sites) for `agent_history_rewrite_reverted` with `fromSha` / `toSha`.
- Add `v2/src/execution/iteration-head-guard.test.ts` with a temp-repo rebase onto a moved base (non-ancestor pre/post), a control that only a worktree-dirty check would miss, descendant-commit and unchanged-`HEAD` negatives, and a `reset --keep` conflict case.
- Add `v2/src/execution/write-loop-iteration-head-guard.test.ts` driving settled `awaitIteration` with a rebasing agent stub so wiring is exercised, not only the standalone module.

## Acceptance criteria

- [x] `v2/src/execution/iteration-head-guard.test.ts`: pre-iteration `HEAD` not an ancestor of post-iteration `HEAD` (temp-repo rebase onto a moved base) restores the pre-iteration SHA and keeps a non-conflicting uncommitted edit; fails against the pre-fix code (guard absent).
- [x] Same file: descendant `HEAD` (agent commit) and unchanged `HEAD` perform no reset and emit no `agent_history_rewrite_reverted` event; fails against the pre-fix code.
- [x] Same file: `reset --keep` conflict yields a failure result naming both SHAs with the branch ref unchanged by the guard; fails against the pre-fix code.
- [x] `v2/src/execution/write-loop-iteration-head-guard.test.ts`: settled `awaitIteration` with a rebasing agent stub restores pre-iteration `HEAD` and logs `agent_history_rewrite_reverted`; fails against the pre-fix code if the guard is not wired through `awaitIteration`.

## Documentation updates

- None (`v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` for this behavior land in [01-ready-repair-history-guard.md](./01-ready-repair-history-guard.md)).
