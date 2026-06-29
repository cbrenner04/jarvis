## Verdict — required outcomes

### 1. Draft all-`model_config` exhaustion must be proven operator-visible

The acceptance criterion binding draft exhaustion requires both `result.kind === "model_config"` **and** stderr containing `plan: model configuration error`. Intent-split proves the equivalent end-to-end (`intent: model configuration error` in `intent-command.sandbox-unrunnable.test.ts`); draft coverage stops at per-agent rotation lines inside `runDraftPhase` and never asserts the terminal harness line emitted by `plan/run.ts` on exhaustion.

**Required:** Test coverage must demonstrate that when every agent in draft order returns `model_config`, operator stderr includes `plan: model configuration error` (with last-agent stderr per spec). The AC is not satisfied until that evidence exists.

**Rationale:** Spec ledger pins unchanged terminal handlers in `plan/run.ts`, but the AC still binds the full operator-visible contract. Ticking without proof creates a false completion signal.

---

### 2. `agent-cli-failure-pipeline.md` must match live behavior

Two sections still describe pre-change semantics:

- **Step 6** describes quota-only rotation; the shared emitter now also emits `model_config` rotation lines for draft and intent-split.
- **`name-only` inventory row** still says `model_config` → fatal; `name-only.ts` advances on `model_config` (binding-predicate parity per spec).

**Required:** Both sections must accurately describe current rotation/fatal behavior.

**Rationale:** Listed in the subspec documentation updates; operator pipeline docs are the audit trail for failure classification → outcome.

---

### 3. `agents.md` must retract the stale preservation claim and scope the predicate correctly

The bullet claiming each phase preserves its exact pre-shared-executor behavior (including `model_config` outcomes) is false for draft and intent-split, which now rotate on `model_config` with new harness stderr.

The advance-predicate description scopes to draft/intent-split but omits `name-only.ts`, which shares the same `quota || error || model_config` predicate (stderr parity explicitly out of scope for that dormant export).

**Required:**

- Revise preservation wording to distinguish live operator phases (draft, intent-split) from paths that remain terminal or dormant.
- Document that `name-only` shares the advance predicate; note that it has no live operator path and no rotation-stderr parity requirement in this intent.

**Rationale:** Misleading preservation language undermines the shared-executor architecture section; predicate documentation must cover all call sites changed in this branch.

---

### Not required (spec-aligned; no actuator action)

- **`name-only` silent `model_config` rotation stderr** — subspec scoped predicate-only parity; no operator path today.
- **`workflows.md` patch mermaid** — describes patch loop where `model_config` remains terminal; prose already updated.
- **Emitter naming (`emitPlanAgentQuotaFallback`, etc.)** — maintainability debt; subspec required extending existing emitter, not renaming.
- **`quota-signals.md` omitting `name-only` from the matrix** — defensible for a dormant export; optional footnote only.
- **`execute.ts` comment omitting `name-only`** — trivial; default-comment staleness is already noted for plan/intent overrides.
- **Mixed `model_config`/`quota` chain exhaustion, duplicate terminal stderr, pre-invocation terminal** — ledger decisions or explicitly optional items; no blocking gap.

---

### Summary

Core cascade behavior on live paths (intent-split, draft) appears implemented correctly: shared emitter, `; falling back` grep contract, predicate parity with prompt, patch/review/prompt untouched. **Three gaps block merge readiness:** missing draft terminal-stderr test evidence, stale `agent-cli-failure-pipeline.md` entries, and inaccurate `agents.md` preservation/predicate wording. Fix those before treating the spec complete.
