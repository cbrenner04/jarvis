---
name: implement-settles-completed-over-exhausted-red-gate
---

# Implement settles `completed` over an exhausted red ready gate, and its repair agent keeps running

## Problem

A v2 implement run whose ready gate stays red through its repair budget settles **`completed`** with
every acceptance criterion ticked and a draft PR over the broken commit. The documented contract is
the opposite: "A red gate demotes the run to `failed` and blocks completion."

Worse, the repair agent is not stopped. Sixteen minutes after every run row for the branch read
`completed` / `not-live`, a `codex` process (child of the owning daemon) was still executing inside
that run's worktree, spawning `bash`/`bun` children — and its worktree lock correctly refused the
re-dispatch that is the only recovery for a red-gate completion.

Net effect: the operator gets a green-looking `completed`, a red PR, no `run resume` (the row is
terminal and not resumable), and no re-run (the lock is held by an agent the harness no longer
tracks).

## Evidence (2026-07-27, run `814f853b`, PR #2229)

```text
ready_gate_repair  attempt 1  gateExitCode 1
boundary_committed outcomeKind done  runStatus completed
ready_gate_repair  attempt 2  gateExitCode 1
→ durable row: completed
```

- `jarvis run list --branch 20260727T033329Z-write-loop-iteration-durability-floor` — all four rows
  `completed` / `not-live`.
- CI on #2229: red. Six new tests hang (30 s timeout each) plus two unrelated v2 failures — the
  same failures the gate saw.
- All acceptance criteria in both subspecs ticked; the PR stayed **draft**.
- `lsof +D <worktree>` 16 min after settlement: `codex` PID 93422, parent = daemon PID 9930, elapsed
  6m23s, with live `bash` and `bun` descendants.
- Re-dispatch refused: `Cannot re-run incomplete spec: process 9930 holds worktree lock`.

Same session, PR #2228 also went red-gate → repair → `completed` and was left in draft. Two of two
implement runs settled `completed` after a red gate.

## Decisions

- A run whose ready gate is still red when the repair budget is exhausted settles **`failed`** with
  `ready_gate_failed`, not `completed`. Rules out the current completion path, which publishes a
  draft PR over a red commit and reports success.
- Settlement stops the repair agent. No agent invocation may outlive the durable row it belongs to.
  Rules out treating the orphan as benign because "the work might still land" — nothing consumes it,
  and it holds the lock that blocks recovery.
- The worktree lock is released when the owning run settles, whatever its outcome. Rules out relying
  on daemon exit to free it.
- A `ready_gate_failed` settle from repair exhaustion is resumable, so the operator's recovery is
  `jarvis run resume` rather than a full re-run. Rules out requiring workspace retirement to retry a
  gate.
- Criteria stay ticked; the failure is the gate, not the spec. Rules out unticking as part of the
  settle.

## Acceptance criteria

- [ ] A run whose gate returns non-zero on every repair attempt settles `failed` with
      `error.reason: "ready_gate_failed"`; a test drives an always-red gate through the repair budget
      and fails against the current `completed` settle.
- [ ] That run publishes no draft→ready flip and its durable row reports `resumable: true` with
      `nextAction: "resume"`; `jarvis run resume` on it re-runs the gate without re-entering the
      write loop.
- [ ] The repair agent invocation is cancelled at settlement; a test asserts no agent process (or
      invocation promise) remains outstanding once the row is terminal, and fails if cancellation is
      removed.
- [ ] The worktree lock is released on every settle path (`completed`, `failed`, `killed`); a test
      asserts a subsequent `jarvis run workflow implement` on the same `(project, branch)` is not
      refused with `holds worktree lock`.
- [ ] A gate that goes green on a repair attempt still completes exactly as today; existing coverage
      stays green.
- [ ] Inverting the exhausted-red-gate guard turns the first test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — state that repair exhaustion settles `failed`
  and is resumable; delete any claim that a `completed` implement row implies a green gate.
- `v2/docs/write-behavior.md` — repair budget exhaustion outcome and agent cancellation at settle.
- `v2/docs/daemon-host.md` — lock release on every terminal settle.
