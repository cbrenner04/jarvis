- Define a unique, stable identity for each cost row and use it for the outcome joins; `name` and `session` alone lack a documented uniqueness guarantee, so 1:1 claims are otherwise unverifiable.

- Define outcome-row lifecycle: when the observer writes/reconciles rows, how reruns amend the matching row, and how duplicate rows are prevented; append-only outcome records would violate the required one-row-per-cost-row contract.

- Name the observer’s population step and its timing in the operator contract; automatic derivation without a defined actor and reconciliation point is not an executable workflow.

- Make source-or-blank rules operational for every derived field: use the audit’s primary source, constrain weak CSV/JSONL/git fallbacks, and require blank plus a note when attribution is unreliable; this preserves the intent’s no-fabrication rule.

- Resolve field representations that determine aggregation: `files_touched` must be count or defined list, overlord aggregation must define its union/count semantics, and duration fields must share units, rounding, and meaning. `total_duration` must not ambiguously mix elapsed duration with the cost sheet’s API runtime.

- Cover plan-involved sessions explicitly: `agent_count` cannot be automatically derived for plan phases under the audit’s telemetry gap, so it must be observer-provided or blank with a note.

- Define the observable meaning of judgment fields before use: completed work units for completed, blocked, and plan-only rows; status hint versus observer override; and treatment of unknown, partial, blocked, canceled, and failure outcomes. Controlled vocabulary values may remain deferred, but these semantics cannot.

- State how the two sheets normalize differing aggregate fields for aggregatable reporting, especially success, duration, and file measures; common names alone do not create comparable values.

- Strengthen acceptance criteria to verify unique joinability, duplicate-safe reconciliation, and the documented source-or-blank population policy, alongside the header-only/no-backfill outcomes. These are required observable contracts under the intent and spec guidance.
