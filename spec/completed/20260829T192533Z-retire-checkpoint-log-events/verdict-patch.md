Reviewing the implementation against the spec and acceptance criteria before issuing a verdict.
## Verdict

### Required outcomes

1. **Align subspec prose with the executable stale-`queuedInput` contract.** In `v2/spec/20260829T192533Z-retire-checkpoint-log-events/00-retire-checkpoint-reprompt-log-events.md`, the Tasks bullet for `reconstructDirectWriteResume` and the Decision-ledger bullet that says stripping `initialIterationsConsumed` **only** contradict the pinned acceptance criterion and decision intent. Persisted `queuedInput` is plain JSON: after checkpoint-reprompt fields leave `WriteLoopInput`, resume must still **explicitly strip stale checkpoint reprompt keys** (`mutationDirectiveReprompt`, `guardCheckpointReprompt`, `keystoneDirectiveReprompt`) **and** `initialIterationsConsumed` before binding — not pass raw `queuedInput` through and not drop sanitization entirely. Update those spec lines so they match that behavior. **No production code change is required**; the current `reconstructDirectWriteResume` implementation already satisfies the acceptance test.

### Rationale

The acceptance criterion for `paused direct write resume strips stale checkpoint queuedInput without seeding iteration budget` is the binding contract. Task/decision-ledger wording that says to strip only `initialIterationsConsumed` would instruct a regression (checkpoint keys would survive JSON round-trip into `executeWriteLoop`). Fixing the spec prevents a future edit from breaking the pinned test while keeping the subspec internally consistent with its own acceptance criteria and durable docs.

### Not required for this slice

- **`promoteQueuedRunImpl` sanitization:** Real but narrow residual risk on `queued` rows; outside this subspec’s pinned scope (`reconstructDirectWriteResume` / log-schema retirement). Follow-up only if parity is desired.
- **Tri-kind historical JSONL pins, dead `_commitRepromptProgressBoundary`, `intent.md` checkbox drift, compile-time-only append enforcement, `PersistedRecord` typing for historical lines:** Valid notes; none block the checked acceptance criteria or durable doc updates for this change.