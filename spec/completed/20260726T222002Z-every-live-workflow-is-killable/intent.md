---
name: every-live-workflow-is-killable
---

# Every live workflow run is killable

## Problem

`jarvis run kill` on a workflow-started run that `list` reports `in-progress`/`live` returns
`run_not_active`. `killHandler` (`v2/src/daemon/daemon.ts:1203`) acts only on
`activeRun.kind === "write-loop"`, and the workflow variant of `ActiveRun`
(`v2/src/daemon/daemon.ts:92-95`) is `{ kind: "workflow"; runId: string }` — it carries no abort
handle, so there is nothing to act on. Observed 2026-07-25: `daemon stop` refused
(`active durable runs`) while `run kill` refused the same run (`run_not_active`); nothing could
clear it short of `kill -9` on the daemon.

Four prior attempts gated kill on a *stall* discriminant and all failed for one structural reason:
every signal tried coincided with the run terminating, so no `(live ∧ reapable)` state was ever
observable by a real kill. Two codex attempts latched off "the active attempt has no bound agent
subprocess", an inference the daemon cannot make. A sharpened spec (#1749) latched on the write-loop
watchdog resolving `timed_out`/`aborted` and on orphan-settle; the faithful implementation (#1760,
closed) was a runtime no-op — `onReapable(runId)` is immediately followed by a terminal
`finishLoop`/`finishIterationTimeout` in the same synchronous continuation, and the orphan `.finally`
latch is a synchronous set-then-delete that never runs for a genuinely never-settling orphan
(8 trials × 200 macrotask kill-polls → zero reaps).

**This intent abandons the stall discriminant entirely.** Kill authorization is *liveness*, the same
predicate the write-loop path already uses. A live workflow is killable because it is live.

## Decisions

- Every workflow `activeRuns` entry carries an abort handle. The daemon owns one `AbortController`
  per workflow invocation, threads its `signal` onto the steps it passes to `executeWorkflow`
  (steps cross IPC as JSON, so the signal is injected daemon-side, not supplied by the caller), and
  stores the controller on the entry created in `onStepRunCreated` and on the claim entry. Rules out
  deriving a handle from the run row or from process inspection — the four failed attempts are all
  variants of that.
- `jarvis run kill <runId>` accepts any workflow-started run with a live `activeRuns` entry, exactly
  as it accepts a live write-loop run. Rules out any stall, idle-age, or progress heuristic in the
  authorization path: liveness is the whole condition.
- A killed workflow settles durable `killed` and retains its worktree and branch; `list` then
  reports `isLive: false`. Rules out worktree teardown on kill — recovery is inspect-then-re-run.
- Idle/output age is **observability only** and is out of scope here. The shipped write-path idle
  watchdog (`idle_output_timeout`) and review-role idle budget already terminate silent invocations;
  any remaining display gap is a separate, later change. Rules out re-introducing a latch.
- A run with no live entry still rejects kill with `run_not_active` — including one already settled.
  Rules out kill becoming a durable-status mutation for non-live rows.

## Acceptance criteria

- [ ] The workflow variant of `ActiveRun` carries an abort handle, and every workflow entry the
      daemon creates (per-step via `onStepRunCreated`, and the claim entry) is constructed with it.
- [ ] `killHandler` accepts a live workflow-started run: it aborts that workflow's controller and
      records durable `killed`. A test drives a genuinely live workflow entry through `kill` and
      asserts an `ok` response; removing the workflow branch from `killHandler` turns it RED.
- [ ] The injected signal reaches step execution: a test asserts the signal the daemon threads onto
      its steps is the one aborted by `kill`, and that aborting it unwinds the in-flight step rather
      than being ignored. Dropping the injection turns it RED.
- [ ] After a killed workflow settles, `list` reports the run `isLive: false` with durable status
      `killed`, and its worktree and branch still exist on disk.
- [ ] A workflow run with no live `activeRuns` entry still rejects kill with `run_not_active`.
- [ ] A live write-loop run's existing kill behavior is unchanged; its current tests stay green.
- [ ] No stall, idle-age, or progress predicate appears in the kill authorization path.

## Documentation updates

- `v2/docs/daemon-host.md` § Live controls on workflow-started runs — kill is accepted on any live
  workflow run; pause/resume remain unsupported.
- `v2/docs/first-workflow-walkthrough.md` § Workflow-started implement — replace "no live kill" with
  the kill contract.
- `v2/docs/operator-runbook.md` — delete the 2026-07-16 gotcha "`run kill` does not work on
  workflow-started runs" and the "kill the agent process tree directly" workaround; the
  `daemon stop` / `run kill` deadlock bullet keeps only its non-workflow half.
- `v2/docs/v1-behaviors.md` — record that workflow-started runs are now killable.

## Prerequisites

- The daemon tracks live workflow invocations in `activeRuns` and deletes those entries when the
  workflow settles (`v2/src/daemon/daemon.ts` `onStepRunCreated` / `.finally`).
- `executeWorkflow` steps already accept an optional `signal` that reaches role invocation
  (`v2/src/execution/workflow-runner.ts:1891`, `:3099`).
