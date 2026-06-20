# Verdict

## Required outcomes

1. **`v1/docs/quota-signals.md` outcome matrix must be internally consistent for Claude exit-0 quota reclassification.**  
   The “Classified kind” column already documents the adapter exception, but the patch behavior, plan behavior, exit-code, and telemetry columns for the zero-exit row still read as unconditional success. When Claude reclassifies to `quota`, those columns must describe quota rotation and quota telemetry — not “continue normal post-iteration completion/progress logic,” “continue normal phase progression,” completion exit `0`, or `ok` telemetry.  
   **Rationale:** Operator-facing semantics changed; the doc file is an explicit acceptance-criteria deliverable and the authoritative outcome matrix must not contradict the Claude section body or `v2/docs/v1-behaviors.md`.

2. **`v1/docs/quota-signals.md` capture workflow must account for stdout-delivered Claude quota envelopes.**  
   The global capture convention still instructs operators to copy stderr only. Claude’s verified monthly-spend-limit sample is exit-0 JSON on stdout. The capture instructions (under the Claude section or the global convention) must state that this signal is captured from stdout, not stderr.  
   **Rationale:** Mislabeling the capture source will cause future samples to be recorded incorrectly and weakens the doc-only verification workflow the spec depends on.

3. **Rename or restructure the Claude “Observed quota stderr” subsection so it does not imply stderr-only samples.**  
   The verified sample lives in stdout JSON; the subsection title should reflect stdout and stderr quota signals (e.g. “Observed quota samples”) or split by delivery channel.  
   **Rationale:** Same doc-alignment requirement as above; cosmetic only in isolation, but part of making the required documentation internally consistent.

## No further action required

- **Adapter classification, diagnostics preservation, patch fallback, tests, and `v2/docs/v1-behaviors.md` updates** satisfy all subspec acceptance criteria. No code changes are required for this verdict.
- **Near-miss envelopes** (`is_error: true`, `api_error_status: 429`, non-quota `result` → `ok`), **string `"429"` coercion**, **process stderr merge on reclassification**, **strict-fallback operator stderr visibility**, **cross-mode integration tests**, **omitted-field test variants**, **subspec-embedded full JSON**, and **test-helper deduplication** are intentional scope boundaries or pre-existing behavior; do not block completion.
