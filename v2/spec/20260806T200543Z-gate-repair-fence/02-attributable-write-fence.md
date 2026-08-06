# Attributable write fence

Ready-gate repair fence-validates against the frozen diff/spec allowset while classification can name a different path set, so repair agents answer Markdown-only `lint:md` reds by editing unrelated production source.

## Decision ledger

- Gate-repair agent writes only to the attributable allowset classification computes for the failing gate (frozen diff/spec union plus per-gate in-scope failing paths from subspec 01) — rules out Markdown failures producing production edits and two divergent path-set notions.
- Refusal names every out-of-scope path in the staged candidate set — rules out silent drops or generic errors.
- Agent-repair fence unification lands here; autofix fence validation against the same attributable allowset completes in subspec 05 after post-autofix typecheck verification — rules out landing inconsistent autofix fence state between subspecs.

## Task checklist

- Unify fence validation in `enforceRepairIterationFence` / `validateReadyGateRepairCompletion` with the classification-derived attributable allowset for agent repair iterations.
- Add a `lint:md`-only gate failure regression where the repair agent stages a `.ts` edit outside the attributable set.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing regression where a `lint:md`-only gate failure is answered with a `.ts` edit: repair is refused, the refusal names the out-of-scope paths, and no repair commit lands.
- [ ] In `v2/src/execution/write-loop.test.ts` `ready-gate repair fence` describe block, a `// @mutate` directive inverting the attributable write-fence guard turns its pinning test RED.

## Documentation updates

- `v2/docs/write-behavior.md` — repair fence is keyed to the failing steps' attributable paths, not diff membership alone.
- `v2/docs/v1-behaviors.md` — record v2 ready-gate repair attributable write-fence contract.
