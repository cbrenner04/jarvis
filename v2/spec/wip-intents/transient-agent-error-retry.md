# Auto-retry transient agent/API errors instead of burning a full attempt

## Problem

~4 runs this session died on transient errors ("API Error: Connection closed mid-response") and
just needed a re-run — but each cost a full operator-triggered attempt. This is distinct from
quota exhaustion, which already has agent fallback. A connection drop mid-response is not a quota
signal and not a code failure; falling through to the next agent (or aborting) wastes the attempt.

## Direction

Reuse the existing invocation machinery. `shared/invocation/execute.ts` already iterates over
bindings (the quota-fallback loop). Extend it so a transient API/network error class re-attempts
the **same** binding a bounded number of times before falling through to the next agent or
failing. Classify transient errors separately from quota (mirror the per-agent quota heuristics
in `v1/docs/quota-signals.md`); cap retries so a persistently-failing endpoint still terminates.

## Out of scope

- Quota detection/fallback — already handled; this is a sibling classifier, not a change to it.
- Retrying real agent failures (non-progress, blockers, code errors) — only transient
  transport/API errors.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record transient-retry behavior and its bound.
- `v1/docs/quota-signals.md` — note the transient class is distinct from quota.

## References

- `shared/invocation/execute.ts` — the binding-attempt loop (`attempts[]`, `:54`–`:73`); natural
  home for a transient re-attempt before advancing the binding.
- `shared/invocation/agents.ts`, `v1/src/quota-harness-messages.ts` — existing per-agent signal
  classification to mirror.
