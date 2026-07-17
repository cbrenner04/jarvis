---
name: agent-spawn-guards-worktree-capacity
---

# Agent spawn guards worktree capacity

Before spawning an agent, v2 prunes stale Git worktree registrations and evaluates the remaining registered-worktree sandbox cost. It automatically retires only workspaces already proven safe by cleanup ownership rules. If live or unsafe-to-retire registrations still put command execution at risk, the run stops before spending agent quota and reports the count, risk, and cleanup action. A lower warning tier tells the operator to clean up before the hard refusal.

## Decisions

- Measure registered Git worktrees at the agent-spawn boundary; rules out estimating risk from directory count or historical run rows.
- Reuse cleanup's merged and live-owner classification for automatic retirement; rules out a second, weaker definition of reclaimable workspace.
- Warn before refusing and refuse before invoking the agent; rules out discovering capacity failure only during implementation verification.
- Deferred to first consumer: warning and refusal thresholds — pin when a caller needs it.

## Out of scope

- Disabling the underlying agent sandbox.
- Reaping live or daemon-wedged runs automatically.
- Changing durable run-row retention.

## Prerequisites

- Merged v2 workspaces can be classified and retired without removing a workspace owned by a live run.

## Documentation updates

- `v2/docs/operator-runbook.md` — capacity warning, refusal, and cleanup recovery; remove the manual worktree-removal stopgap and no-cleanup gotcha.
- `v1/docs/operator-runbook.md` — remove the mid-session cleanup caveat and `E2BIG` worktree-count diagnosis after the preflight owns prevention.
- `v2/docs/v1-behaviors.md` — record the v2 agent-spawn capacity guard.
