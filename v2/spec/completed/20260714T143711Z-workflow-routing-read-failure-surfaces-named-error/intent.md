---
name: workflow-routing-read-failure-surfaces-named-error
---

# A failed routing read surfaces a named error, not `invalid_params`

When linked-index routing in `runLinkedImplementStep` cannot read the index, the
rejection is swallowed by `executeWorkflow`'s catch-all in
`v2/src/daemon/daemon.ts` and reported to the operator as
`invalid_params: ENOENT: no such file or directory, open …`. That framing hid a
launch-blocking bug behind a params error for a full release cycle: the operator
sees a bad-arguments message for a state problem.

A routing-read failure should surface as a distinct, named error identifying the
index path it tried to read and why the read failed.

## Decisions

- Name the routing-read failure at its source rather than widening the daemon
  catch-all's classification heuristics. Rules out sniffing `ENOENT` inside
  `daemon.ts`.
- The catch-all stays for its other callers.

## Out of scope

- The worktree-existence fix itself (separate behavior).
- Reclassifying the `daemon.ts` catch-all's other callers.

## Documentation updates

- `v2/docs/operator-runbook.md` — the named error and what it means.
- `v2/docs/v1-behaviors.md` if this changes existing documented behavior.

## Prerequisites

- `executeWorkflow` rejections are surfaced to the operator through the daemon error path.
