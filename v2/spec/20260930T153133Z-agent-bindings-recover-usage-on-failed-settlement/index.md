# Agent bindings recover token usage on failed settlement

Implement **00** before **01**–**04** so recovered usage on non-ok results reaches `invocation_completed` rows in integration tests.

- [ ] [00 — Non-ok invocation results carry recovered usage into telemetry](00-non-ok-invocation-usage-telemetry.md)
- [ ] [01 — Non-ok settlement retains stream buffers for usage recovery](01-non-ok-settlement-retains-stream-buffers.md)
- [ ] [02 — Stream-json bindings recover usage on non-ok finalize](02-stream-binding-usage-recovery-on-non-ok-finalize.md)
- [ ] [03 — Codex binding recovers session rollout usage on non-ok settlement](03-codex-rollout-usage-recovery-on-non-ok.md)
- [ ] [04 — Integration: intent acceptance for binding usage recovery](04-integration-intent-acceptance.md)
