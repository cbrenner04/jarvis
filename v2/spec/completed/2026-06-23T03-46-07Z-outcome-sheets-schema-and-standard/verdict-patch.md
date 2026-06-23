- Require a durable, exact mapping from each overlord cost identity to its member session-cost identities and session base. Without it, overlord duration, distinct-file union, and earliest outcome date must remain blank with a note. `session_count` and a shared report label do not establish membership.

- Align `v2/docs/outcome-data-source-audit.md` with the reporting standard. It must not present `api_time` or `HEAD~1` as acceptable substitutes where the standard requires cost-row duration and identity-bound git attribution. The audit is the required primary-source authority, so conflicting guidance makes reconciliation non-executable.

- Define how a patch cost identity is bound to its JSONL namespace and run window for initial reconciliation, reruns, and corrections. JSONL fields alone do not identify `(report, name)`; absent a durable binding, JSONL-derived date, mode, agent count, and hints must be blank with a note.

- Narrow the CSV date fallback to a valid, identity-bound date source, or remove it. The current cost CSV schema has no date column and `report` is not necessarily a date, so it cannot safely populate `report_date`.

These outcomes are required for the spec’s identity-bound source-or-blank policy and its one-row-per-cost-row reconciliation contract.
