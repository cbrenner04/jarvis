---
name: agent-history-rewrite-guard
---

# Agent-rewritten lane history passes the fence and strands publication on a foreign tip

## Problem

A write-step agent can rebase, reset, or amend the lane during an iteration. Nothing checks `HEAD` across the iteration: the ready-repair fence baseline snapshots only uncommitted paths (`snapshotAutofixBaseline`, `v2/src/execution/write-loop.ts:4432`), so a rewritten-but-clean tree passes `enforceRepairIterationFence` (`write-loop.ts:4098`) and `commitRepairAndRepublish` (`write-loop.ts:4213`) pushes. The lane's own earlier publish is no longer an ancestor of `HEAD`, and only a continuation rebase records `leaseFromSha` (`v2/src/commands/cleanup.ts:3433`, `v2/src/commands/stale-reset-workspace.ts:156-157`), so `resolveLeaseTip` (`v2/src/execution/completion-publisher.ts:165-176`) raises `ForeignRemoteTipError` on the lane's own push. The run settles `completion_commit_failed` and needs hand reconciliation. `prompts/implement/rules.md:25` forbids commits but not history rewrites.

## Evidence

- 2026-10-01 lane `20261001T150227Z-resume-path-inventory-binds-real-declaration`, open draft PR #4377 at `1a72dc155`. Publication run `c9328c5d` `ready_gate_repair` 18:26Z (`test:v2` per-file timeouts). The repair agent (cursor Composer 2.5) ran `git rebase origin/main` twice (reflog `rebase (start): checkout origin/main` 18:28Z onto `b2c911fe1`, 18:37Z onto `4a02334c8`; harness continuation rebases name a SHA, e.g. 16:26Z `checkout e1f735c4e…`). Transcript: "Rebased … onto current `origin/main` … Push the rebased branch (`--force-with-lease` …)". `loop_finished` 18:45Z: `Remote branch … is at 1a72dc155…, which this lane did not publish; refusing to push over it.` Operator merged origin's tip (`ebfc3e238`) and resumed.
- The publisher behaved as documented (`operator-runbook.md` "Foreign tip on a publication push"); the defect is the unguarded rewrite upstream. Not covered by `lane-pr-history-guard-scopes-to-current-lineage` (PR-history guard, not push lease).

## Decisions

- Record `HEAD` before every write-step agent invocation (implement iterations, `write-loop.ts:1499`; ready repair, `runReadyRepairIteration` at `write-loop.ts:3514`). After the agent returns and before any fence, autofix, or commit, if the recorded SHA is not an ancestor of `HEAD`, the iteration rewrote history.
- On rewrite: `git reset --keep <pre-iteration HEAD>` (restores the lane, keeps the agent's uncommitted edits when non-conflicting) and log `agent_history_rewrite_reverted` with `fromSha`/`toSha`; the iteration then proceeds normally. If `reset --keep` fails, settle resumable `completion_commit_failed` naming both SHAs, push nothing.
- Descendant `HEAD` moves (agent-created commits) are out of scope.
- `prompts/implement/rules.md` commit rule extends to: do not rebase, merge, reset, amend, or push; Jarvis owns history and base integration. Prompt revision bumps.
- Publisher lease authorization (`leaseFromSha` only) is unchanged.

## Acceptance criteria

- [ ] `v2/src/execution/iteration-head-guard.test.ts` (new): pre-iteration `HEAD` not an ancestor of post-iteration `HEAD` (temp-repo rebase onto a moved base) → guard restores the pre-iteration SHA and keeps an uncommitted non-conflicting edit; fails against a guard that only checks the working tree.
- [ ] Same file: descendant `HEAD` (agent commit) and unchanged `HEAD` → no reset, no event.
- [ ] Same file: `reset --keep` conflict → failure result naming both SHAs; branch ref untouched by the guard.
- [ ] `v2/src/execution/write-loop-ready-repair.test.ts` (new; `write-loop.test.ts` is over budget pending its split): a ready-repair agent stub that rebases the lane onto a moved base yields a publisher push from the pre-iteration lineage (no `ForeignRemoteTipError`) and an `agent_history_rewrite_reverted` log event.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md § Ready gate repair` — iterations that rewrite lane history are reverted to the pre-iteration `HEAD`.
- `v2/docs/operator-runbook.md` "Foreign tip on a publication push" note — name agent rewrites as a cause and the `agent_history_rewrite_reverted` event.
- `v2/docs/prompts.md` — rules revision note.
- `v2/docs/v1-behaviors.md` — record the history-rewrite guard.
