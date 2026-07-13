# A blocked workflow run destroys its worktree and its evidence

A `jarvis run workflow implement` run that ends `blocked` leaves **nothing** behind: no
worktree, no branch, no blocker text, no agent output. The agent's work is unrecoverable
and the operator cannot learn why it blocked.

## Problem

Observed 2026-07-13, first launch of `2026-07-12T23-14-44Z-review-step-emits-log-events`
through the `implement` preset (run `e93a8429-2726-400b-9643-0fb753340f99`):

- The run created a worktree and invoked codex. **Telemetry confirms real work**:
  `duration_ms: 174000`, `exit_kind: ok`, `worktree_path:
  ~/.jarvis/worktrees/jarvis/2026-07-12T23-14-44Z-review-step-emits-log-events`.
- The run then reported `blocked` / `agent_blocked` / `inspect_spec`, `resumable: false`.
- Afterwards: **the worktree directory does not exist, the branch does not exist, and git
  has no registration for either.** Nothing was left on disk.
- **No `## Blocker` was written anywhere** — not in the spec on `main`, not in the (now
  destroyed) worktree copy. The run log holds only `iteration_started` →
  `boundary_committed(blocked)` → `loop_finished(blocked)`.

So a run consumed ~3 minutes of paid codex time, produced work, declared itself blocked,
and then deleted the only evidence of both. The operator is left with the word `blocked`
and the token `inspect_spec`, and no way to act on either.

This is the same *class* as the review no-op — a step reports a terminal status while
leaving no trace that would let anyone check it — and it defeats the runbook's standing
rule to verify rather than trust a status. There is nothing here to verify against.

## Decisions

- **A blocked run must retain its worktree and branch.** `blocked` is a state the operator
  is expected to inspect and resume from; destroying the worktree makes that impossible.
  Rules out treating `blocked` as terminal-and-reclaimable like a completed run.
- **A blocked outcome must carry blocker text naming why.** `inspect_spec` is a reason code,
  not an explanation. If the agent wrote a `## Blocker`, it must survive; if the agent
  blocked without writing one, that itself is the harness defect — surface it as such rather
  than recording a bare `blocked`. Relates to seed `blocked-outcome-with-no-blocker-text`
  (deleted in #1481 as fixed — **it is not fixed on this path**).
- **Never delete an agent's output as part of an error path.** Whatever teardown runs on the
  blocked path is destroying paid work with no operator confirmation and no archive.

## Prerequisites

- None.

## Out of scope

- Why the agent chose to block on this particular spec (unknown — the evidence was deleted).

## Documentation updates

- `v2/docs/operator-runbook.md` — blocked-run recovery; remove any claim that a blocked run
  can be inspected in its worktree until this holds.
