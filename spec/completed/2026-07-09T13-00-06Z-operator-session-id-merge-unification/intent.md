---
name: operator-session-id-merge-unification
---

# Unify operator-session-id attachment semantics

## Problem

Two functions attach `operatorSessionId` to telemetry with different,
undocumented semantics: `applyOperatorSessionId` (`v2/src/daemon/daemon.ts:1240`)
always overwrites/merges the daemon's id in; `withOperatorSessionId`
(`v2/src/cli.ts:431`) defers entirely (returns input unchanged) when the
caller already set `telemetry`. The divergence is silent — nothing documents
which caller relies on which behavior.

## Direction

Replace both with one function with one documented merge policy.

## Decisions

- Deferred to first consumer: which of overwrite vs defer-if-present becomes
  the single policy — pin by checking which callers of each function
  currently depend on the other's behavior; if both call sites tolerate
  either policy, prefer overwrite (daemon-assigned id always wins) since it
  is the stricter guarantee for telemetry correctness.

## Documentation updates

- Wherever the unified function is documented (doc-comment per
  `v2/docs/documentation-standard.md` inline tiering, since this is a
  genuinely non-obvious contract) — state the merge policy explicitly.

## Prerequisites
