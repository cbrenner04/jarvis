Both findings are minor and not spec-blocking, but one has real merit worth requiring.

## Verdict

**Required outcome 1 — persist the underlying landing-error message alongside the named cause.**

The invocation-failure state written on deferred-landing failure must retain both the stable `failureKind`/named cause AND the actual error text from the failed landing operation (mirroring how the pre-review path at workflow-runner.ts:659 persists `prePublicationError: message`). AC02 requires a "persisted named landing cause suitable for retry diagnostics" — a bare enum tag without the underlying message is not sufficient for diagnosis when an operator needs to distinguish a collision from an I/O error from a validation failure during a stuck retry. Add the message field to the persisted landing-failure state so both paths are consistent and an operator can retry-diagnose without reproducing the failure.

No other changes required — the idempotent-retry behavior on an already-`"completed"` checkpoint is harmless by design (landing's ownership-file + `stageDir` removal makes re-entry a no-op), so no fix is needed there; leave it as-is.