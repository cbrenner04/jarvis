---
name: daemon-stop-refusal-checks-run-liveness
---

# `daemon stop` and `run kill` deadlock each other over a non-terminal, not-live run row

## Problem

A durable run row that is non-terminal **and** not live is refused by both verbs, so nothing can clear it:

- `daemon stop` refuses because the row is non-terminal — `v2/src/daemon/daemon-lifecycle.ts:212-216` filters `listRuns()` on `!isTerminalRunStatus(run.status)` and throws `DaemonStopRefusedError` with **no liveness check at all**.
- `run kill` refuses `run_not_active` because the row is not in the daemon's memory (`daemon-run-lifecycle-handlers.ts:779,814`).

The only recorded recovery is `kill -9 <daemon-pid>` followed by `jarvis daemon start`, so startup reconciliation can settle the orphan. That recovery is **destructive and shared** — the daemon serves every registered project, so it discards uncommitted worktree edits for any genuinely live run on the machine.

It is also dangerously easy to misapply. The `in-progress` + `not-live` tell is *identical* to two non-bugs that must never be `kill -9`'d: a [superseded same-key daemon](../../docs/operator-runbook.md#daemon-lifecycle) still working its own runs, and a bound-then-unlinked socket. The runbook now carries three separate liveness checks whose only purpose is to keep an operator from reaching for this recovery by mistake.

## History

Originally seeded as `a-daemon-lost-run-row-deadlocks-the-daemon` and lost in the #1762 bulk backlog purge without the fix shipping. Re-seeded 2026-09-07 after a runbook audit found its cited seed missing; the behavior was re-verified against `main` at that time.

## Decisions

- `daemon stop`'s refusal set counts only runs that are non-terminal **and** live; a non-terminal row with no live owner is reconciled on the way down rather than blocking the stop; rules out a durable row the operator cannot clear by any non-destructive verb.
- Reconciliation of orphaned rows on stop uses the same settlement path as startup reconciliation (`killed` / `daemon_restart`); rules out a second settlement code path with its own terminal-status semantics.
- The refusal message distinguishes live blockers from orphaned rows and names each, so an operator can tell the guard-working case from the deadlock without cross-checking `run list`; rules out a bare id list that reads identically in both cases.
- `run kill --force` remains the path for a stale row while the daemon stays up; this seed removes the need for it to be the *only* path; rules out widening force-kill semantics instead of fixing the refusal.

## Acceptance criteria

- [ ] A daemon-lifecycle test proves `daemon stop` succeeds when the store holds a non-terminal row with no live owner, and that the row is settled terminal by the stop; it fails against the current `!isTerminalRunStatus`-only filter.
- [ ] A test proves `daemon stop` still refuses when a non-terminal row **is** live, and that the refusal names it as live; it fails against a fix that simply stops refusing.
- [ ] A test proves the refusal message distinguishes live blockers from orphaned rows when both are present.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — retire the `kill -9` recovery for this shape (keep the superseded-daemon and unlinked-socket liveness checks, which are separate).
- `v2/docs/daemon-host.md` — stop-time reconciliation of orphaned non-terminal rows.
- `v2/docs/v1-behaviors.md` — record the liveness-aware stop refusal.
