# `jarvis run workflow` blocks the terminal, then lies about being done

## Problem

`jarvis run workflow intent|plan|implement` blocks with no output for the whole first run — minutes
to tens of minutes — then prints a run ID and a one-line outcome JSON and **exits zero while the
workflow is still running**. The remaining steps continue under a *different* run ID.

Observed 2026-07-21 on `20260721T020102Z-durable-review-debate-run-row`: the command returned
`{"runStatus":"completed",...}` for run `b424b81b`; at that moment the branch had no commit, no
push, and no PR, and run `0f7ccf55` was live on the same branch finishing the work. An operator who
trusts the exit reads this as "completed with no PR" — the documented `v2/docs/operator-runbook.md`
§ Recovery symptom — and has previously hand-recovered a healthy run on that misread.

So the command combines the worst of both: it holds the shell hostage *and* its exit is not the
workflow's completion.

Consequences:

- The operator must background every launch by hand to keep a usable shell.
- The run ID — the handle for `run log` / `run wait` / `tui` — is printed *last*, so it is
  unavailable for the entire window in which you would want to observe the run.
- Exit zero does not mean the workflow finished; correctness requires cross-checking
  `jarvis run list` for a live row on the same branch.

The daemon already owns the workflow; blocking on one constituent run is a client-side choice.

## Decisions

- Print the run ID as soon as the daemon admits the run, before any waiting, on every workflow
  preset. This holds whether or not the command detaches.
- An attached command must not exit until the **workflow** is terminal, not merely its first
  constituent run; its final outcome describes the workflow. Rules out today's behavior of
  reporting one run's outcome as the command's result.
- Add a non-blocking launch mode that returns after admission, leaving the workflow to the daemon;
  pin whether it is the default or a flag in the plan, but the run ID must be usable immediately
  either way.
- Emit progress at run boundaries rather than nothing at all while attached, naming each
  constituent run as it starts.
- Rules out changing daemon-side execution or run lifecycle; this is CLI attachment behavior only.
- Rules out a new top-level subcommand — fold into `jarvis run workflow` (north star: fewer commands).

## Acceptance criteria

- [ ] `jarvis run workflow <preset>` prints its run ID immediately after daemon admission, before
      the workflow reaches any terminal state.
- [ ] An attached `jarvis run workflow implement` whose workflow spans multiple run rows does not
      exit until every constituent run is terminal, and its reported outcome is the workflow's.
- [ ] A non-blocking launch returns promptly with the run ID and a zero exit for an admitted run,
      and the workflow continues to completion under the daemon.
- [ ] A failed admission still exits non-zero with the existing named failure.
- [ ] An attached launch emits a line at each run boundary rather than silence.
- [ ] `jarvis run log <id>` and `jarvis tui log <id>` work with the ID as printed at admission.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — launching and observing without blocking a shell.
- `v2/docs/write-behavior.md` — workflow CLI attachment behavior.
