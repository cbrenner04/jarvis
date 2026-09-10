---
name: surviving-mutation-settlement-records-killing-set
---

# Record the killing set and its observed result on a surviving-mutation settlement

A `surviving_mutation_failed` settlement names only the mutation site, so the only way to falsify it is to re-derive the killing set by hand and repeat the flip-and-test. The false positive in run `1e1f893c` cost exactly that.

Behavior: the verifier's surviving-mutation result carries the resolved killing test paths it actually ran and that set's observed result, and the `surviving_mutation_failed` settlement recorded by the write loop carries them through to the run record and operator error, so an operator can compare the report against a hand flip-and-test without reconstructing resolution.

Documentation: `v2/docs/write-behavior.md` records the re-run-before-settling rule and what the settlement carries.

## Prerequisites

- A surviving mutation is confirmed by an isolated re-run of the resolved killing set before it is reported.
