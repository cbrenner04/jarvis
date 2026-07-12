- Ready-gate timeouts must remain operational failures (exit `6`), not `ready-gate-failed` (exit `10`). Only a completed verification with a red result may use the terminal ready-gate-failed contract.

- Any nonzero completion outcome must not emit successful `criteria-complete` / `completed-spec` terminal telemetry or a successful run-summary reason. Successful completion signals require a green gate and exit `0`.

- Add active coverage for legacy `readyGateRetryBound`: a non-negative saved value loads with an ignored/deprecation warning, is absent from supported serialized/config output, and cannot cause retries. This is an explicit acceptance criterion; obsolete retry/fix-up tests may be removed.
