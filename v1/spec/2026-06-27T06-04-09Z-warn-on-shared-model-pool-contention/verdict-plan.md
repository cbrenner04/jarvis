- Define which live sessions count as shared-pool contention. The spec currently says “live operator/orchestration session” but does not bound the match set, leaving observable ambiguity between Jarvis-owned Claude sessions and any generic Claude process. The intent is about operator/orchestration contention, so the warning contract must name that scope.

- Clarify that contention detection keys off the resolved selected patch primary, not merely the first configured rung, and make that observable in acceptance coverage. The Decisions section already points there, but the spec should close the gap where tier/floor/override resolution changes the selected primary; otherwise an implementation could warn from raw config and still appear compliant.

- Make warning cardinality an acceptance-level behavior. The spec should require a single run-start harness warning for a contention event, not repeated warnings per matching process or later in the run. This is observable operator behavior and belongs in the contract, not only the task list.

- Require the warning to carry the minimum actionable meaning without freezing exact copy. The operator needs to understand that the selected patch primary shares the Claude pool with a live operator/orchestration session so they can pause the competing session. Without that payload, the warning can satisfy “a warning exists” while failing the intent.

- Expand durable doc updates to include the operator runbook, not only run-loop and parity docs. This is an operator-facing workflow warning with a corresponding operator action, so the durable home should cover both behavioral reference and remediation guidance.
