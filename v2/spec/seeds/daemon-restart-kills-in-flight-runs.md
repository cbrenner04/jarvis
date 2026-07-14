---
name: daemon-restart-kills-in-flight-runs
---

# A daemon restart kills every in-flight run, and the harness demands a restart after every merge

Two rules the operator must follow at once are in direct conflict:

1. **Bounce the daemon after merging any v2 change** — it runs a code snapshot from start, so a
   merged fix has no effect until restart (seed `daemon-runs-stale-code-until-restarted`).
2. Runs take minutes. Merges happen while runs are in flight.

So landing a v2 fix destroys concurrent work. Observed 2026-07-14: two `implement` runs
(`20260714T023459Z-idle-output-timeout-default-below-iteration-wall`,
`20260714T023459Z-terminal-run-records-usage-and-cost`) were three minutes into their write step
when a merge-triggered `daemon stop && daemon start` landed. Both reconciled to
`killed` / `daemon_restart` mid-iteration. The agent work in that iteration — and its token spend —
was lost; only the worktree survived.

`jarvis run resume <id>` recovers the run, but nothing tells the operator a restart is about to do
this, nothing offers to wait, and nothing resumes the killed runs automatically. The reconciler's
own log line (`run_reconciled`) is the only trace, and you only see it if you go looking.

The existing `daemon-runs-stale-code-until-restarted` seed asks for the restart to be unnecessary.
This seed is about the restart being *safe* when it does happen — the two can ship independently.

## Decisions

- `jarvis daemon stop` refuses when non-terminal runs exist, naming them, unless forced. Rules out
  today's silent mid-iteration kill.
- A forced stop, and any restart that finds orphaned non-terminal rows, **auto-resumes** them once
  IPC opens rather than leaving them `killed` for the operator to notice and hand-resume.
- Rules out: making the operator diff `run list` against a pre-merge snapshot to find what died.

## Out of scope

- Hot-reloading daemon code so no restart is needed (`daemon-runs-stale-code-until-restarted`).
- Multi-operator coordination. Single operator; the conflict above is self-inflicted, not a race.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — replace "Orphaned non-terminal runs after daemon
  restart" (which claims the restart is benign) with the real semantics.
- `v2/docs/daemon-host.md` — stop/restart contract.
