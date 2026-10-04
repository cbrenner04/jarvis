## Verdict

**Required before treating this slice as closed:**

1. **Sync `v2/spec/20260906T161030Z-canonical-pipeline-execution-state-and-stage-claims/intent.md` acceptance criteria.** All three subspecs and `index.md` are checked; intent still lists four open boxes. The top-level intent contract must match landed work before archive.

2. **Fix or remove the dead `@mutate` on `isPipelineContinuable agrees with derivePipelineState on fan-out continuable fixtures`.** Mutating away the derivation gate still yields `false` because `reopenedFailurePermitsActivation` rejects the unreopened `implement/alpha` failure. The pin does not fail; it adds false regression confidence. Either use a fixture where only the derivation consolidation differs, mutate a line that actually gates the outcome, or drop the pin.

**No other actuator changes required.** Subspec acceptance criteria are met: durable adoption routing with effective `@mutate` on subspec 00 paths, bypass pinning, derivation consolidation, and doc updates in the listed durable homes. Remaining items are follow-ups, not blockers:

- Rename the three stale `dispatchPipelineStage refused claim` test titles (assertions are correct; names are misleading).
- Optionally broaden `state-store.md` and remaining `pipeline-execution.md` seams to match `daemon-host.md` / `v1-behaviors.md`.
- Fan-out overlapping-continuation coverage, post-resolve TOCTOU hardening, release-outcome handling, and broader bypass guards were not in scope and are not required here.