---
name: ready-gate-attributable-repair-scope
---

# Ready-gate repair allowset stays inside the run diff

## Problem

For non-test ready gates, `resolveAttributableRepairAllowset` builds the agent repair allowset from attributable failing paths alone, so a pre-existing lint failure in an unrelated file authorizes editing that file even though it is outside the frozen run diff.

## Decisions

- For non-test gates with attributable paths, agent repair allowset is `{ p ∈ attributable | p ∈ resolveGateRepairAllowset(frozen, error) }` (frozen diff/spec allowset plus `gateRepairAllowsetPaths` extensions); attributable paths outside that envelope do not expand repair authorization.
- When every attributable failing path lies outside `resolveGateRepairAllowset(frozen, error)`, treat the gate failure as pre-existing and settle without agent repair (same class of outcome as other out-of-scope ready-gate failures).

## Acceptance criteria

- [ ] `ready-finalize.test.ts` or `write-loop.test.ts`: ready-gate repair with a lint failure attributable only to a path outside the run diff performs no agent repair edit to that path and settles as a pre-existing/out-of-scope failure; fails against the pre-fix `resolveAttributableRepairAllowset`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — ready-gate repair allowset is intersected with the frozen run diff envelope (including gate extensions).
- `v2/docs/v1-behaviors.md` — catalog attributable repair allowset intersection with the frozen fence.

## Prerequisites

- Ready-gate repair persists a frozen allowed path set derived from merge-base diff, untracked inventory, and spec tree before agent repair iterations.
