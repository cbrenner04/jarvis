1. Persist every successful runtime-smoke result even when the subsequent draft-to-ready flip fails. Ready-flip failure must not discard `observed-clean` or `not-runnable` evidence. Add regression coverage for this terminal path. The spec requires one durable record per successful verifier result.

2. Enforce the documented non-empty `discoveryReason` invariant before a `not-runnable` outcome reaches the durable log, including coverage for empty input. A plain `string` currently permits records that violate the spec and operator contract.
