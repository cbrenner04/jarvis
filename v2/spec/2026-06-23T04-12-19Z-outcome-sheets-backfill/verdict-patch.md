- Amend outcome-row provenance so every report-derived judgment and `completed_work_units` identifies the exact report artifact and its positive mapping to the cost identity. Generic phrases such as “merged spec” or “close shipped all rows” are insufficient.

- Where no exact report-to-session/overlord mapping survives, leave the judgment or work-unit field blank and state the unrecoverable reason in `notes`.

This is required by the spec’s exact-identity/source-or-blank policy and acceptance criterion that every non-blank historical field have recorded auditable provenance; report similarity cannot establish attribution.
