## Verdict — required outcomes

### 1. Production idle escalation must use the `reviewActuator` ladder, not implementation `activeAgents`

**What must be true:** On a real `jarvis run` completion, when review actuator idle-escalates past rung 0, each later rung spawns the agent named in `resolveSubRoleAgentOrder(config, "reviewActuator")` (pre-override config snapshot), not `activeAgents[rungIndex]` from the implementation ladder.

**Why:** The spec pins the idle ladder to pre-override `reviewActuator` order and `actuatorAgents[i]` as a test-injection slot aligned with that ladder. `completion-pipeline` still passes full `ctx.activeAgents` while the actuator now indexes `actuatorAgents[rungIndex]`. When implementation and `reviewActuator` ladders differ in length or content, rung 2+ can spawn the wrong agent. Direct `runPatchReviewPhase` tests pass because they hand-align arrays; production does not.

**Verification:** Add or extend coverage on the production path (`completion-pipeline` → `runPatchReviewPhase`) where `activeAgents` and `reviewActuator` order diverge, asserting escalation rung 2+ resolves from config ladder agents.

---

### 2. Final-rung terminal idle must not double-record telemetry

**What must be true:** After writing actuator `watchdog-idle-timeout` telemetry and throwing on final-rung idle, no second telemetry row is emitted for the adjudicator attempt.

**Why:** `runReview` routes actuator `ReviewTerminalError` through `recordAdapterFailure` when `telemetryRecorded` is unset, duplicating failure telemetry on the wrong role. Other terminal actuator paths already set `telemetryRecorded: true`. The gated AC requires correct terminal `watchdog-idle-timeout` telemetry and exit `11`; duplicate rows violate that contract.

---

### 3. `agents.md` role-resolution must match idle escalation semantics

**What must be true:** The "Agent order resolution by role" section no longer states review actuator is unconditionally head-only. It must distinguish: quota and initial binding remain head-only; idle-output watchdog stall walks the full configured `reviewActuator` ladder (with terminal stop on the final rung).

**Why:** The idle-escalation bullet was updated per gated doc AC, but the role-resolution section still contradicts it. Operators reading agent-order docs get the wrong idle contract.

---

### 4. `config.md` `reviewActuator` description must not contradict idle behavior

**What must be true:** The `subRoleAgentOrder.reviewActuator` entry in `config.md` must not describe verdict actuator as unconditionally head-only without the idle full-ladder caveat (same quota-vs-idle distinction as `agents.md` / `v2/docs/v1-behaviors.md`).

**Why:** Operator-facing config reference still says "verdict actuator (head-only)" with no idle exception, contradicting shipped behavior and the reconciled docs in this slice.

---

### Not required (no actuator action)

- Quota head-only on review actuator (spec-scoped; documented asymmetry in `v2/docs/v1-behaviors.md`).
- 3+ rung chains, partial multi-idle chains, `workflows.md` diagram, `intent.md` exit-8 drift, iteration-wall `exitReason` pinning, shared idle-detection helper extraction.
- Pre-override ladder under `--agent` beyond existing preservation AC (code path is correct when `actuatorAgents` is omitted).
