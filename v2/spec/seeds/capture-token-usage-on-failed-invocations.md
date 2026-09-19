---
name: capture-token-usage-on-failed-invocations
---

# Capture token usage on failed invocations

## Problem

Failure cost is invisible when an agent consumes tokens before error, quota, stall, or cancellation. Usage fields currently live on `InvocationOk`, and the shared telemetry builder reads them only for `kind: "ok"`. Available usage must survive failure classification and teardown so efficiency research can price unsuccessful work.

## Evidence

The [September 19 study](../../docs/research/20260919T151848Z-september-api-cost.md) has 1,039 non-ok calls covering 57.43 subprocess hours with no usage pricing: 91 errors (30.12 hours), 3 stalls (17.81 hours), and 945 quota exits (9.50 hours). Separately, 21 `ok` calls lack usage across 4.42 hours; those are a successful-call capture gap, not the failure population.

## Desired outcome

- Preserve available input, output, cache-read, and cache-write counters independently of invocation outcome, through adapter classification, fallback, and telemetry emission.
- Recover the latest authoritative counters from retained stream events or uniquely correlated agent session data when a terminal result is absent, including timeout/cancellation teardown. Keep recovery bounded and best-effort; it must not delay settlement indefinitely or change failure/fallback behavior.
- Keep usage attached to its invocation and binding. Cumulative counters must not be summed repeatedly or charged to the next fallback attempt. Identify partial usage explicitly when the final total is unavailable.
- Compute API cost from captured counters with the existing price-key/catalog semantics. Preserve unknown fields as null; a failed call without counters is unpriced, never assumed free. Do not estimate tokens from duration.
- Existing failure classifications, exit diagnostics, and telemetry join IDs remain intact. Capture failures surface as warnings without replacing the original outcome.

## Verification

Use injected streams/session fixtures to prove usage survives non-ok exits and teardown, cumulative events do not double count, fallback keeps separate usage, and missing counters remain null. Include a pre-result failure with no usage and a failure after partial usage. No ambient agent sessions or machine config.

## Documentation updates

- `v2/docs/telemetry-capture.md` — failure usage, partial-counter provenance, and unavailable-data semantics.
- `v2/docs/shared-invocation.md` — adapter recovery and settlement behavior.
