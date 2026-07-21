- Persist `runtime_smoke_outcome` as soon as verification succeeds, even if the later draft-to-ready flip fails or crashes. Add regression coverage for successful smoke followed by `ready_flip_failed`. The spec requires a durable record for every successful verifier result.

- Enforce non-empty `discoveryReason` for every persisted `not-runnable` outcome, including injected or future producers. Invalid empty reasons must not enter the durable log, with regression coverage. This is an explicit event-contract invariant, not merely a convention of the current verifier.
