---
name: repair-exhausted-error-names-site-and-killing-set
---

# Name the mutation site and killing set in the repair-exhausted operator error

`mutation_repair_exhausted` is terminal and never re-admitted, yet its operator error says only that the mutation survived every repair attempt. The operator must reconstruct the site and killing set before they can check the report by hand.

Behavior: the composed operator error for `mutation_repair_exhausted` names the mutation site (file and line) and the killing set the verifier ran, alongside the existing recovery guidance.

## Prerequisites

- A surviving mutation is confirmed by an isolated re-run of the resolved killing set before it is reported.
- The `surviving_mutation_failed` settlement records the resolved killing set and its observed result.
- Mutation-repair commits are pushed before the run settles.
