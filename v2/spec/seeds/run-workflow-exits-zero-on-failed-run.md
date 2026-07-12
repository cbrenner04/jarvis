# `jarvis run workflow` exits 0 for a run that fails

The CLI reports success for every workflow launch, including ones that fail
seconds later. Exit status tracks "did the daemon accept the request", not "did the
run succeed", so the operator's shell has no signal and nothing can be scripted or
gated on it.

## Problem

Observed 2026-07-12 across `plan`, `plan-reviewed-light`, and `implement`:

```sh
$ jarvis run workflow plan --ready-intent v2/spec/ready-intents/run-async-path-terminal-log-event.md
e788122e-405e-4f76-8a3c-8d1e352ccfe4
$ echo $?
0
```

The run failed (`invalid_token`, `runStatus: failed`, `resumable: false`). The
operator sees a bare UUID and exit 0, and must independently know to run
`jarvis run list` or `jarvis run log <id>` to discover the failure. Three of three
presets dogfooded this way looked like successes at the shell.

This is a gate-trust problem in the same family as
`run-cannot-report-complete-over-red-gate`: an exit code that cannot distinguish
success from failure is worse than no exit code, because scripts and operators both
read it as success.

Compounding it, the bare-UUID output offers no next step — no hint that
`jarvis run wait <id>` exists, no pointer to the log.

## Scope

- Decide and document what `run workflow` exit status means. Either:
  - block until terminal and exit non-zero on a failed run (matching `jarvis1 run`
    semantics the operator already has muscle memory for), or
  - keep fire-and-forget, but exit non-zero when the run reaches a terminal failure
    before the CLI returns, and print the run's outcome rather than only its id.
- Whichever is chosen, a failed run must never leave the shell at exit 0.
- Print an actionable next line on launch (`jarvis run wait <id>` /
  `jarvis run log <id>`), not a bare UUID.

## Decisions

- Fire-and-forget is a legitimate design for a daemon-backed run, but "exit 0 = we
  accepted your request" must not be spelled the same way as "exit 0 = it worked".
- The async launch path is the one an operator scripts against; it is the path that
  most needs a trustworthy status.

## Out of scope

- The underlying preset failures (`invalid-token-discards-completed-work`,
  `implement-write-step-renders-prompt-without-placeholders`).

## Documentation updates

- `v2/docs/write-behavior.md` — CLI surface: exit-status contract for
  `run workflow`.
- `v2/docs/operator-runbook.md` — drop the "exit 0 means launched, not succeeded"
  caveat once this ships.
