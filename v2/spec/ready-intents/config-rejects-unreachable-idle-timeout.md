---
name: config-rejects-unreachable-idle-timeout
---

# Config load rejects an idle timeout that can never fire

A config with `idleOutputTimeoutMs >= iterationTimeoutMs` silently disables idle
escalation: the wall always fires first, so the ladder is dead. Config load accepts it
today without comment.

Make `validateConfig` treat a non-zero `idleOutputTimeoutMs` that is not strictly less
than `iterationTimeoutMs` as an invalid combination, with an error naming both values and
why the pairing is incoherent. `idleOutputTimeoutMs: 0` keeps its existing meaning
(explicitly disabled) and is not rejected.

Coverage: a config pairing the two at equal values fails validation; strictly-less passes;
zero passes.

## Documentation updates

- `v1/docs/config.md` — state the constraint (idle must be strictly less than the
  iteration wall) alongside the two timeout fields.

## Prerequisites

- Default `idleOutputTimeoutMs` is strictly less than default `iterationTimeoutMs` (otherwise the shipped defaults fail their own validation)
