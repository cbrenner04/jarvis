Reviewing the implementation and docs against the spec to issue a grounded verdict.
## Verdict: refinements required

### 1. Align `shared-invocation.md` computed-cost condition with spec semantics

**Outcome:** Durable cursor finalize docs must state that `cost_source: "computed"` applies when the binding's `priceKey` is **priced** (has at least one catalog rate), not merely when it "matches a catalog row."

**Rationale:** `computeCost` returns `no-price` for keys that exist but have all-null rates. The subspec, `v1-behaviors.md`, and `operator-runbook.md` already use "priced"; `shared-invocation.md` currently overstates the computed branch and misleads operators aggregating on `cost_source`.

---

### 2. Document the present-usage / all-null-tokens cost pairing

**Outcome:** Durable docs (`shared-invocation.md` and/or `telemetry-capture.md`) must record that when the terminal frame carries a `usage` object but all token fields are null, cursor finalize settles `usage_source: "agent"` and `cost_source: "no-usage"` (not `no-price`).

**Rationale:** This patch routes the with-usage finalize branch through `computeCost`, changing cursor behavior for that edge from `agent` + `no-price` to `agent` + `no-usage`. The subspec decision makes this an intentional contract; operator-facing docs must match so telemetry consumers do not misread `cost_source` relative to `usage_source`.

---

**Not required for merge:** binding-layer test for all-null usage (layered coverage in `cursor-json.test.ts` and `cost.test.ts` is sufficient for current ACs); catalog-load-failure test (spec-accepted graceful degradation without an injection seam); additional tests or doc churn beyond the two outcomes above.