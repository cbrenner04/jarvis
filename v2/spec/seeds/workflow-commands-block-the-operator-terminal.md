# `jarvis run workflow` blocks the terminal for the whole run

## Problem

`jarvis run workflow intent|plan|implement` blocks until the workflow is fully terminal — write
loop, review, shrink, publication, and the full-tier ready gate — then prints the run ID and a
one-line outcome JSON. On an implement run that tail alone is ~8–15 minutes with no output
(see `v2/docs/operator-runbook.md` § Known gotchas, `in-progress` + `not-live`).

Consequences, observed repeatedly:

- The operator must background every launch by hand to keep a usable shell.
- The run ID — the handle for `run log` / `run wait` / `tui` — is printed *last*, so it is
  unavailable for the entire window in which you would want to observe the run.
- A blocked terminal reads as a hang; healthy runs have been `pkill`ed on that misread.

The daemon already owns the run; blocking is a client-side choice, not a requirement.

## Decisions

- Print the run ID as soon as the daemon admits the run, before any waiting, on every workflow
  preset. This holds whether or not the command detaches.
- Add a non-blocking launch mode that returns after admission, leaving the run to the daemon;
  pin whether it is the default or a flag in the plan, but the run ID must be usable immediately
  either way.
- Emit progress at run boundaries rather than nothing at all while attached.
- Rules out changing daemon-side execution or run lifecycle; this is CLI attachment behavior only.
- Rules out a new top-level subcommand — fold into `jarvis run workflow` (north star: fewer commands).

## Acceptance criteria

- [ ] `jarvis run workflow <preset>` prints its run ID immediately after daemon admission, before
      the workflow reaches any terminal state.
- [ ] A non-blocking launch returns promptly with the run ID and a zero exit for an admitted run,
      and the run continues to completion under the daemon.
- [ ] A failed admission still exits non-zero with the existing named failure.
- [ ] An attached launch emits a line at each run boundary rather than silence.
- [ ] `jarvis run log <id>` and `jarvis tui log <id>` work with the ID as printed at admission.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — launching and observing without blocking a shell.
- `v2/docs/write-behavior.md` — workflow CLI attachment behavior.
