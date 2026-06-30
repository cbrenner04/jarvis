## Verdict: refinements required before merge

Core design is correct: shared parser, no config persistence, patch implementation vs review/shrink split, plan actuators vs review-panel split. Remaining gaps are **checked acceptance criteria that overstate wired behavior**, **undertested default-fallback paths**, and **operator-doc drift**. Address the outcomes below.

---

### 1. Spec and intent must match wired runtime scope

**Outcome:** Subspec `02` acceptance criteria and `intent.md` must describe only plan phases actually driven by substituted `modes.plan.agentOrder` on the live path: **draft, verdict-actuator, PR narrative**. Treat `intent-draft` and `name-only` as deferred (same as `name-only` in `02` decisions) — remove them from checked ACs and from `intent.md` desired behavior.

**Outcome:** Subspec `01` must not claim single-rung `--agent` + `--tier hard` yields an empty post-slice ladder exit. Actual behavior: `ladderLength <= 1` always starts at rung 0. Reword or drop that AC so checked criteria match code.

**Rationale:** Checked ACs are merge gates; claiming unwired phases or unreachable tier failure states is false completion.

---

### 2. Default-fallback paths must be test-backed

**Outcome:** Override-negative coverage must include production-default resolution, not only explicit `subRoleAgentOrder` / `reviewAgentOrder` overrides:

- **Plan:** With `--agent` set, `modes.review.agentOrder` unset, and no test-injected `reviewAgentOrder`, review panel (adversary/advocate/adjudicator) and panel quota rotation must use pre-override `modes.plan.agentOrder`, not the flag ladder.
- **Patch:** With `--agent` set and no `subRoleAgentOrder` keys, review actuator and shrink must resolve from pre-override `modes.patch.agentOrder` (default `reviewActuator` fallback), not the override ladder.

**Rationale:** `plan/run.ts` snapshots `resolveReviewAgentOrder(rawCfg)` before substitution; `patch/run.ts` keeps `subRoleResolutionCfg` as pre-override. Existing tests always pass explicit orders, so the leak scenario from the original review remains unproven.

---

### 3. Checked plan ACs need override-specific proof

**Outcome:** Tests must demonstrate that under `--agent`:

- Plan **PR narrative** agent selection (`prNarrative: "agent"`) follows the overridden ladder, not persisted config.
- Actuator **quota / `model_config` cascade** advances through the overridden ladder (not only draft binding selection).

**Rationale:** Subspec `02` ACs for PR narrative and quota cascade are checked; current tests cover draft binding and split-ladder review, not these behaviors under override.

---

### 4. Checked patch escalation ACs need broader proof or narrowed claims

**Outcome:** Either add override-specific tests for **quota** and **idle-timeout** escalation on the substituted implementation ladder, or narrow subspec `01` AC to match what is tested (today only **no-progress** is proven under override).

**Rationale:** AC explicitly names all three escalation signals; architectural sharing of `activeAgents` is insufficient while the criterion remains checked.

---

### 5. Operator documentation must not contradict split-ladder semantics

**Outcome:**

- `v1/docs/plan-mode.md` **Phase 2** must state (or cross-link) that under `--agent`, review panel uses the pre-override snapshot while verdict-actuator uses the override — not only the later footnote.
- `v2/docs/v1-behaviors.md` plan review bullet must note pre-override snapshot when `--agent` is set.
- `v1/docs/agents.md` must document that patch **`prNarrative: "agent"`** uses the implementation override ladder (asymmetric with review/shrink; mirrors plan PR narrative behavior).
- Root `jarvis1 help` usage line for `plan` must include `--agent` (run already does; `jarvis1 help plan` is accurate today).

**Rationale:** Operators reading Phase 2 or v1-behaviors review text alone will assume `--agent` affects reviewers; patch PR narrative scope is undocumented asymmetry.

---

### 6. Plan CLI error contract must be test-asserted

**Outcome:** Plan invalid `--agent` test must assert stderr includes the `plan:` prefix (parity with run CLI coverage and subspec `00` caller-prefix contract).

**Rationale:** Prefix behavior is specified; run path is asserted, plan path is not.

---

### 7. Single source of truth for agent names

**Outcome:** `AGENT_NAMES` must not be duplicated between `config.ts` and `agent-order-validation.ts`; one canonical list feeds validation and typing.

**Rationale:** Partial extraction already risks drift when adding agents; low-cost consolidation prevents silent validation divergence.

---

### Not required

- Full E2E CLI happy-path tests via argv (seam injection matches substitution path; acceptable).
- `run:` vs `jarvis1:` wrapper asymmetry on stderr (pre-existing convention; spec satisfied).
- Flag-value trimming, programmatic `agentOrderOverride` seam validation, or `runPlanReviewPhase` API hardening (defensible as-is).
- Re-checking already-green shared parser, config immutability, explicit split-ladder tests, `--resume-review` / `--tier` override tests, or dormant-phase wiring.
