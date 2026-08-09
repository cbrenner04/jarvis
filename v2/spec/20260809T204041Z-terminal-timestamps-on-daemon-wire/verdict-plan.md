- Reconcile the unconditional `finishedAtMs` guarantee with legacy/unbackfilled terminal runs and terminal-at-creation rows. Either include the persistence/backfill work needed to make every terminal row satisfy the contract or explicitly narrow the contract, tests, and documentation to the terminal transitions actually guaranteed. The current fallback prohibition makes the universal claim unsatisfiable.

- Prove the latest durable run finish is selected across all three sources. Coverage must show `finishedAt`, attempt `completedAt`, and `reconciledAt` each winning when independently latest.

- Resolve pipeline finish derivation for decided approval gates. The spec must cover `decidedAt` as a durable finish candidate for rejected pipelines and pipelines terminating at an approved final gate, or explicitly defer and document the resulting timestamp discrepancy.

- Use precise status terminology throughout: the `endedAt` invariant applies to terminal stage-run statuses (`succeeded`, `failed`, `interrupted`, `skipped`), not approval decisions (`approved`, `rejected`). State the approval exclusion wherever the broader invariant is described.

- Replace ambiguous “dispatch refusal” language with the actual terminal dispatcher result path. Admission-claim refusal is non-terminal and must not be presented as a settlement write.

- Define an exhaustive, falsifiable completeness guarantee for the settlement-writer inventory. Acceptance must detect any unclassified terminal stage-run write in both named modules; a hand-maintained site list or formatting-sensitive mutation alone is insufficient to prove “every path.”

- Split the oversized stage-timestamp subspec into independently testable replacements: one for exhaustive settlement-writer coverage/fixes and one for the failed-before-start producer-to-wire contract. Preserve every original task and acceptance outcome exactly once across the replacements, and link every replacement from `index.md`.

- Require integrated coverage that drives a real pre-admission throw through durable storage and observes it through `pipeline_list`, proving terminal status, non-null `endedAt`, and null `startedAt` across the complete operator-visible seam.
