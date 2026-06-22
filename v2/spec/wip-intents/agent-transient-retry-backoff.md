---
name: agent-transient-retry-backoff
---

# Agent transient-retry has no backoff — a sustained provider overload exhausts the cap and kills the run

## Problem

`runAgent` (`v1/src/agents/spawn.ts`) retries transient agent errors (`isTransientSignal` —
`overloaded`, `service unavailable`, 502/503/504/529, connection-closed/reset, …) up to
`TRANSIENT_RETRY_CAP = 2` (3 attempts total). The retry loop has **no backoff** — the three
attempts fire back-to-back. This was a deliberate choice when the cap was added, but it means a
**sustained** provider overload (an Anthropic 529/overloaded window lasting tens of seconds to
minutes) is hit by all three rapid attempts at once, the cap exhausts, and the run dies on
`agent-error`.

Observed this session: the `finalize-complete-but-dirty-run` **plan** died with `exit_reason:
agent-error` during the review pass when opus was briefly overloaded (the same window also tripped
the observer's own model classifier). The retry fired but couldn't outlast the overload because all
attempts landed inside the same few seconds. Recovery was a manual `plan --resume` — exactly the kind
of hands-on step the observer should not need ([[observer-touches-only-jarvis-commands]]).

The sibling `harness-transient-retry-git-gh-ops` spec **added bounded backoff** to the git/gh retry
for precisely this reason ("network transients — DNS, overload, TLS — benefit from a brief pause").
The agent path should get the same treatment so the two transient-retry paths are consistent.

## Direction

Add a bounded backoff between agent transient re-attempts in `runAgent`, mirroring the git/gh sync
retry:

- A short, capped backoff schedule (internal constant) between attempts; the cap still guarantees
  termination. Consider widening the cap slightly (e.g. 2→3) so the spaced attempts span a realistic
  overload window — but keep it bounded.
- Inject the sleep behind a seam so tests don't wall-clock sleep (reuse the pattern from
  `withSyncTransientRetry`).
- Keep classification (`isTransientSignal`) and the quota/model-config ordering unchanged; this is
  only about *spacing* the existing retries.

## Out of scope

- Widening the transient classifier surface — `overloaded`/`service unavailable`/529 already match;
  the failure was timing, not classification.
- Quota fallback — separate signal.

## Documentation updates

- `v2/docs/v1-behaviors.md` and `v1/docs/quota-signals.md` — agent transient-retry now backs off
  between attempts (matching the git/gh path).

## References

- `v1/src/agents/spawn.ts` `runAgent` (lines ~197–217): the no-backoff retry loop; `TRANSIENT_RETRY_CAP`.
- `v1/src/agents/quota.ts` `isTransientSignal` / `sharedTransportPatterns` (529/overloaded already covered).
- Mirror the bounded-backoff + injectable-sleep seam from `withSyncTransientRetry`
  (`v1/src/gh.ts`, shipped via `harness-transient-retry-git-gh-ops`).
- Evidence: `finalize-complete-but-dirty-run` plan died `agent-error` on an opus overload during
  review this session; recovered by manual `plan --resume`.
