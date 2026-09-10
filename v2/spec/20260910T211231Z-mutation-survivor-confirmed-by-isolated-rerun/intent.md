---
name: mutation-survivor-confirmed-by-isolated-rerun
---

# Confirm a surviving mutation with an isolated re-run before reporting it

Diff-derived mutation verification reports `surviving-mutation` on the strength of one execution of the resolved killing set. A single contended or otherwise unreliable pass produced a false survivor on a guard the killing test does kill (run `1e1f893c`, `v2/src/daemon/pipeline-daemon-resolution.ts:123`), stranding a complete lane.

Behavior: before returning a `surviving-mutation` result, `verifyDiffDerivedMutations` re-runs the resolved killing set once more against the still-mutated tree, in isolation. A failing re-run is a kill (candidate passes, verification continues); only a second clean pass reports the survivor. The confirmation run stays inside the existing verification deadline and killing-set budget rules, and the inconclusive/non-terminating paths are unchanged.

## Prerequisites

- Diff-derived mutation verification resolves a killing test set per changed file and settles surviving mutations.
