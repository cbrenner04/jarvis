---
name: transient-agent-error-retry
description: Bounded re-attempt of the same binding on transient API/network errors, distinct from quota fallback.
---

# Auto-retry transient agent/API errors instead of burning the attempt

## Behavior

A transient transport/API error (e.g. "Connection closed mid-response") re-attempts the **same**
binding a bounded number of times before falling through to the next agent or failing. This is a
sibling classifier to quota — a connection drop is neither quota exhaustion nor a code failure, so
the binding-attempt loop retries it in place rather than advancing the agent or aborting.

- Classify transient transport/API errors separately from quota, mirroring the per-agent signal
  heuristics already used for quota.
- On a transient result, re-attempt the same binding; cap retries so a persistently-failing
  endpoint still terminates and the chain proceeds (advance or fail) as before.
- Non-transient outcomes (ok, quota, model_config, real error) keep their current control flow.

## Out of scope

- Quota detection/fallback — unchanged; this is a sibling classifier, not a change to it.
- Retrying real agent failures (non-progress, blockers, code errors) — transient transport/API
  errors only.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record transient-retry behavior and its bound.
- `v1/docs/quota-signals.md` — note the transient class is distinct from quota.

## Prerequisites

- The binding-attempt loop advances agents on quota and stops on terminal errors.
- Per-agent stderr/exit-code signal classification exists for quota detection.
