# A failed ready-flip strands the run `in-progress` and hangs `run workflow` forever

When the post-completion `gh pr ready` flip fails, the run row is never settled to a terminal status.
It sits `in-progress` / `not-live` permanently, `jarvis run workflow` never returns, and the
workflow's worktree claim is never released — so the next invocation on that seed is refused
`worktree_claimed`.

The only way out is a daemon bounce, which kills every other in-flight run
(`daemon-restart-kills-in-flight-runs`), and the documented recovery from *that* is
`jarvis run resume`, which is itself broken (`resume-of-a-killed-run-has-no-bindings`). The recovery
path is circular.

## Problem

Observed 2026-07-14 on `main` at `8b19c3dd`. Run `83d50cb3` (`intent/daemon-restart-kills-in-flight-runs`).

The write loop finished cleanly — the run's own log is a normal, complete three-event loop:

```json
{"seq":1,"event":{"kind":"iteration_started"}}
{"seq":2,"event":{"kind":"boundary_committed","outcomeKind":"done","runStatus":"completed"}}
{"seq":3,"event":{"kind":"loop_finished","loopOutcomeKind":"complete","iterationsConsumed":1}}
```

The ready-intents were written and the draft PR (#1569) was published. But `run list` still showed:

```
83d50cb3  jarvis  intent/daemon-restart-kills-in-flight-runs  in-progress  not-live  -  -  -  -
```

`in-progress` with nothing live. The CLI process (`cli.ts run workflow intent`) was still alive and
waiting; it had to be `pkill`ed. Killing it left the claim held, and the next `intent` invocation was
refused:

```
worktree_claimed: intent: existing workflow is owned by another invocation; resume the recorded invocation
```

— advising a resume that cannot work.

## The failure is undiagnosable, by construction

The only trace is in `~/.jarvis/daemon.log`:

```
gh pr ready: transient network error; retrying (attempt 2/3)
gh pr ready: transient network error; retrying (attempt 3/3)
```

`ready-finalize.ts` labels **every** publish exception a transient network error, so the real reason
is discarded. It was not a network error: `gh pr ready 1569` succeeded instantly from the operator's
shell moments later, on the same machine, against the same PR. This is
`publish-failure-is-always-a-transient-network-error` reproduced live — and it is what turned a
recoverable failure into an undiagnosable one.

## Scope

- A publish/ready-flip failure settles the run to a terminal status with a named reason. A run whose
  work completed must never remain `in-progress` after its finalize step fails.
- `jarvis run workflow` returns when the workflow reaches a terminal state, including a failed
  finalize. It must not block indefinitely.
- The workflow's worktree claim is released on terminal settle — including the failed-finalize path —
  so a re-invocation is not refused `worktree_claimed`.
- A claim held by a run that is no longer live is reclaimable without bouncing the daemon.

## Decisions

- Terminal-settle on finalize failure rather than retrying forever. The work is already committed and
  the PR already exists; the run is done, the *flip* failed. Rules out treating a finalize failure as
  a still-running run.
- Preserve the underlying error. Rules out the current blanket "transient network error" label, which
  is what made this cost an hour instead of a minute. Compose with
  `publish-failure-is-always-a-transient-network-error` — fix them together or that seed first.
- The remediation on a failed flip should name the PR and the actual error, not `resume`.

## Out of scope

- Why the daemon's `gh pr ready` failed while the operator's succeeded — unknowable until the error
  is preserved. That is the point.
- The claim/ownership model itself.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery for a failed ready-flip; remove the advice to resume.
- `v2/docs/daemon-host.md` — terminal settle on finalize failure, and claim release.
