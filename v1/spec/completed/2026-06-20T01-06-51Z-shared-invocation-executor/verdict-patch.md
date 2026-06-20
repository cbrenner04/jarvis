All three findings are confirmed against the code. Issuing the verdict.

---

# Verdict

Three real, uncaught regressions must be fixed. Each violates a pinned acceptance criterion of its subspec, and each is masked by tests that use model-ignoring fakes or lack coverage of the affected path. The byte-identical/telemetry criteria cannot catch any of them because all three are control-flow or attribution-identity divergences outside those signals.

## Required outcomes

1. **`name-only.ts` and `intent-split.ts` must preserve advance-on-`error`.**
   The pre-migration single-call plan loops advanced to the next agent on a classified hard `error` (the same behavior `draft.ts` retains). These two paths now build bindings with no advance predicate and fall to the executor's quota-only default, so an `[error-agent, ok-agent]` order that previously rotated and returned `ok` now stops and returns the error. Outcome: both paths must again advance on `error` as well as `quota`, returning `ok` when a later agent succeeds after an earlier agent's classified hard error. Add per-path regression coverage proving the `[error, ok] → ok` rotation, since no existing test exercises it. This is mandated verbatim by spec 00: each consumer must preserve its *exact* pre-D advance/stop-on-`error` behavior. (`verdict-actuator` correctly remains stop-on-error and needs no change.)

2. **Shrink pass-commit attribution must use the winning agent's real model label.**
   On a successful shrink, the commit trailer is derived from an agent reconstructed from the model-less binding id with an empty-string model, so a real Claude agent yields an empty attribution label instead of its human-facing model label (or the default-model fallback). Outcome: the `shrink:` pass commit must carry the same attribution label the configured winning agent produced pre-migration. Thread the configured model through to attribution (or recover it by matching the winning binding against `modes.patch.agentOrder`, as the telemetry path already does). Add a test asserting the real `attributionLabel()` output, not a fake that ignores the model. Required by spec 03's "single attributed `shrink:` commit on pass."

3. **Review binding `agentLabel` must be the agent's attribution label, not `agent (model)`.**
   The new binding sets `agentLabel` to a synthetic `"${agent} (${model})"` string and feeds it into commit attribution. Plan-review routes this label directly into its write-boundary-blocker, blocker-handling, and pass commits, so plan-review commit/PR trailers now read e.g. `claude (claude-opus-4-8)` instead of the human-facing label. Outcome: plan-review pass/blocker commit trailers must be identical to pre-migration output; set the label from the live agent's `attributionLabel()`. Add/extend coverage asserting the real label in a plan-review commit. Required by spec 02's "review role/blocker/commit behavior unchanged." (Patch review and telemetry are unaffected.)

## Note (non-blocking)

After fix 3 moves the review binding `id`/map key back to `attributionLabel()`, two configured agents sharing a model collapse to the same map key. This is a pre-existing latent assumption of agent+model uniqueness in `agentOrder`; current configs satisfy it. Not required for this pass, but a comment or index-based keying would harden it. The `as T` binding casts and the dead `configuredModel`/`createAgent` plumbing in the patch binding are cosmetic and not regressions — no action required.