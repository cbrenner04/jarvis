1. Ensure every successful runtime-smoke result is logged before its corresponding terminal `loop_finished` event. Add regression coverage asserting order, since terminal-event consumers may stop reading at `loop_finished`.

2. Preserve and log successful smoke evidence when the later ready flip fails. A `ready_flip_failed` run must retain the prior `observed-clean` or `not-runnable` outcome; smoke failures must remain solely on the existing failure path.

3. Enforce that persisted `not-runnable.discoveryReason` is non-empty after trimming, including for injected finalizers. Add coverage rejecting empty or whitespace-only reasons.

These outcomes are required by the spec’s “each successful verifier result” contract, its non-empty discovery-reason criterion, and the documented event ordering.
