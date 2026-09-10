---
name: mutation-repair-commits-pushed-before-settlement
---

# Push mutation-repair commits before the run settles

In run `1e1f893c` three `mutation-repair` commits were never pushed: the resume settled `mutation_repair_exhausted` without republishing, so the PR head stayed at the pre-repair commit and its green CI described a tree that no longer existed. Merging on that CI would have dropped the repair work.

Behavior: mutation-repair commits are pushed to the branch before the run settles, whatever the settlement kind, so the branch tip and the PR head agree at every terminal mutation-repair outcome.

Documentation: `v2/docs/operator-runbook.md` (Flip-and-test false-positive check) records that a false positive can reach `mutation_repair_exhausted` and that the branch tip may be ahead of the PR head after that settlement.

## Prerequisites

- A surviving mutation is confirmed by an isolated re-run of the resolved killing set before it is reported.
- The `surviving_mutation_failed` settlement records the resolved killing set and its observed result.
