---
name: stale-daemon-dispatch-auto-bounces-and-retries
---

# A stale-daemon dispatch auto-bounces the daemon and retries

When a work dispatch hits the stale-daemon guard (daemon loaded revision != invoking CLI revision), `jarvis` restarts the daemon and retries the dispatch once instead of refusing — but only when the restart is safe (no genuinely live run to kill). This removes the per-merge manual bounce that the guard otherwise forces, reusing daemon-restart auto-resume so reconciled orphans are not lost.

## Decisions

- On a stale-guard mismatch at `start`/`resume`/workflow-start dispatch, stop and start the daemon, then retry the original dispatch exactly once against the fresh daemon; rules out refusing outright and rules out an unbounded retry loop.
- Gate the auto-bounce on safety: proceed only when no run is genuinely live (`isLive`); if any live run exists, refuse without bouncing and name the live run(s), because a restart kills the in-flight iteration's uncommitted work. Reconciled non-terminal (not-live) orphans do not block the bounce — daemon-restart auto-resume recovers them.
- Report the auto-bounce on stderr: that the daemon was stale (name loaded/current), that it was restarted, how many orphaned runs were reconciled/auto-resumed, and that the dispatch is being retried; rules out a silent restart the operator cannot audit.
- After the single retry, if the dispatch still fails the guard (revisions still differ) or the daemon does not come back, exit nonzero with the underlying reason; rules out masking a genuinely broken restart as success.
- Provide an opt-out (`--no-auto-bounce` flag, and/or config) that restores the plain refuse-with-guidance behavior; default is auto-bounce on. Rules out forcing auto-restart on an operator who wants manual control.
- Leave the guard's exempt commands (health, status, list, log/tail, wait, pause, kill, daemon start/stop) unchanged; they never trigger an auto-bounce.

## Documentation updates

- `v2/docs/write-behavior.md` — dispatch auto-bounce-and-retry contract, safety gate, opt-out, and output.
- `v2/docs/operator-runbook.md` — replace the "hand-bounce before every dispatch after a v2 merge" stopgap with automatic bounce-and-retry; note the live-run refusal case and the opt-out.
- `v2/docs/v1-behaviors.md` — v2-only auto-bounce dispatch behavior.

## Prerequisites

- Stale-daemon dispatch guard compares daemon loaded revision with the invoking CLI revision (shipped: `stale-daemon-refuses-new-work`).
- Daemon startup reconciles orphaned non-terminal runs and auto-resumes those with a resolvable snapshot (shipped: `daemon-restart-auto-resumes-orphaned-runs`).
