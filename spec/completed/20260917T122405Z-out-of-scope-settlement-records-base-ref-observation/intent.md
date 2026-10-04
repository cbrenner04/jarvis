---
name: out-of-scope-settlement-records-base-ref-observation
---

# Out-of-scope settlement records the base-ref observation

A `ready_gate_out_of_scope` row currently records only `readyGateOutsidePaths` and a detail string, so an operator cannot audit the exoneration without re-running the tests by hand.

## Decisions

- For each exonerated path, the probe returns what it observed: pass/fail counts and the base commit the tree was verified at. The settlement persists that observation next to `readyGateOutsidePaths`, through `readyGateOutOfScopeLogFields` and the run row.
- The detail string names the observation for each path, for example `…: <path> (base <sha>: 0 pass / 1 fail)`.
- Scope is limited to what the settlement records. Classification does not change.

## Acceptance criteria

- [ ] A test proves an out-of-scope settlement records, for each path, the base-ref observation its exoneration was based on: counts and the verified base commit.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: what the out-of-scope settlement records for each path.

## Prerequisites

- The base-ref probe reports a path as reproducing only when it fails conclusively at a tree verified to be the base commit, and an inconclusive probe settles a repairable red gate.
