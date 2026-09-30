# Agent bindings recover token usage on failed settlement

Prerequisite: `invocation-completed-records-failure-usage` lands the optional usage/cost/warnings fields on non-ok `InvocationResult` variants and the any-kind `createInvocationCompletedRecord` mapper; this lane only produces values on those fields and does not change `execute.ts` types or the mapper.

- [ ] [00 — Non-ok settlement retains stream buffers for usage recovery](00-non-ok-settlement-retains-stream-buffers.md)
- [ ] [01 — Stream-json bindings recover usage on non-ok finalize](01-stream-binding-usage-recovery-on-non-ok-finalize.md)
- [ ] [02 — Codex binding recovers session rollout usage on non-ok settlement](02-codex-rollout-usage-recovery-on-non-ok.md)
- [ ] [03 — Integration: intent acceptance for binding usage recovery](03-integration-intent-acceptance.md)
