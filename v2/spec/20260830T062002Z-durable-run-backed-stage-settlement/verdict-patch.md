1. Prevent premature settlement during live inter-step gaps. A completed entry row with a later durable step not yet created must not be interpreted as terminally `killed` without durable invocation-terminal evidence. Settlement must no-op when terminality is unproven, with regression coverage and aligned durable docs.

2. Preserve `runtime_smoke_failed` evidence. Failed stage settlement must retain the specific terminal cause and stored diagnostic message instead of degrading to generic `harness_failure`; add direct coverage.

3. Strengthen the failed-rollup regression. Use a completed entry row and a failed durable sibling so the test proves settlement uses the workflow rollup rather than merely the entry row’s status.
