# Every publication failure is reported as a "transient network error"

`v2/src/execution/completion-publisher.ts:188` and `v2/src/execution/ready-finalize.ts:75` both
retry on **any** thrown error and print the same line:

```text
gh pr ready: transient network error; retrying (attempt 2/3)
```

Neither inspects the error. The only special case is a non-fast-forward push. Every other cause —
a `gh` auth failure, a missing PR, a bad branch name, a rate limit, a repo permission error — is
retried three times as if it were a network blip, and then thrown with the operator having been
told, three times, something that may be false. `~/.jarvis/daemon.log` this session is a wall of
that one line with no cause anywhere in it.

## Problem

Observed 2026-07-14. Two of twelve `intent-reviewed` runs
(`intent/v2-worktrees-have-no-dependencies-so-no-gate-can-run`,
`intent/v2-has-no-idle-output-watchdog`) went to `failed` / `landing_failed`, while
`~/.jarvis/telemetry.jsonl` shows every agent invocation for those runs at `exit_kind: ok`. The
work was done; the landing dropped it. **What actually failed is not recoverable from any log the
harness wrote** — the operator-facing record says "transient network error", the run log says
`loop_finished: invocation_failure`, and neither is the truth.

Running the same `gh pr ready <branch>` by hand from the run's own worktree succeeds immediately,
so the failure is not the network and not the worktree.

Same family as the P0 pattern: **a status asserted without the evidence that would substantiate
it.** Here the harness asserts a *cause*.

## Decisions

- **A retry notice names the actual error.** The retried failure's message/exit code is surfaced
  verbatim (stdout+stderr tail), not replaced with a guess at its cause.
- **Only retryable causes are retried.** An auth/permission/not-found failure fails fast on the
  first attempt rather than burning three attempts and 2s of backoff.
- **A failed landing names what failed.** `landing_failed` / `invocation_failure` on a run whose
  agent invocations all exited `ok` must carry the publication step's real error.
- Both call sites (`completion-publisher`, `ready-finalize`) get the same treatment; do not fix one.

## Prerequisites

- None.

## Out of scope

- The `run workflow` exit code (`run-workflow-exits-zero-on-failed-run`).
- Whether the review step logs at all (`review-step-emits-log-events`).

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — drop the "check `~/.jarvis/daemon.log`" advice for
  publication failures once the run log carries the cause.
