# v2-architecture outer/inner loop

## Problem

`v2/docs/v2-architecture.md` documents the agent/model split and
`(agent, role) → model` resolution at a high level but defers inner rung
escalation to the agent-model-config slice. Readers cannot see how outer
agent quota-fallback composes with inner per-role model rungs.

**Depends on:** [00 - Agent model config durable doc](./00-agent-model-config-doc.md)
(`v2/docs/agent-model-config.md` must exist first).

## Decisions

- **`v2-architecture.md` owns short composition overview only** — schema,
  validation matrix, flattening algorithm, consumption modes, terminal
  outcomes, and price derivation live in `agent-model-config.md` — rules out
  duplicating durable-home content in architecture prose.
- **Edit per-project config section in place** — add outer/inner loop overview;
  rules out a parallel escalation section elsewhere.
- **Cross-link `agent-model-config.md` for all schema and loop detail** —
  rules out re-stating `AgentModelConfig` types or validation rules here.
- **Outer advance trigger is quota-only** — no role-driven agent reorder —
  parity baseline is patch/plan + `shared-invocation.md`, **not** v1 prompt
  mode (where `model_config` can advance agents) — rules out claiming outer
  semantics match v1's combined `{agent, model}` chain.
- **Inner loop is per `(agent, role)`** — landing on an agent resets to that
  agent's `rungs[0]` for the step's role — rules out carrying rung index across
  agents or invocations.
- **Replace "follow-on slice" / deferred inner-rung placeholders** in
  `role-resolution.md` step-binding section with a cross-link to
  `agent-model-config.md` — rules out leaving stale deferral prose after this
  slice lands.

## Task checklist

- Update `v2/docs/v2-architecture.md` per-project config: short overview of
  nested loops — outer agent quota-fallback; inner ordered model rungs per
  `(agent, role)` (quota-only advance; `model_config`/`error` terminal).
- State inner rung exhaustion on an agent triggers outer fallback (same role,
  next agent's `rungs[0]`); head-only `actuator` quota advances outer only.
- Cross-link `v2/docs/agent-model-config.md` for schema, validation,
  flattening, consumption modes, and price derivation.
- Update `v2/docs/role-resolution.md`: replace inner-rung deferral with
  cross-link to `agent-model-config.md`; keep role taxonomy ownership in
  `role-resolution.md`.

## Acceptance criteria

- [ ] `v2/docs/v2-architecture.md` per-project config documents outer agent
      quota-fallback and inner per-role model rung escalation as composed
      loops, with quota as the sole inner advance trigger.
- [ ] `v2-architecture.md` states `model_config` and `error` do not advance
      rungs or agents.
- [ ] `v2-architecture.md` states quota after inner rung exhaustion advances
      the outer agent loop for the same role (next agent's `rungs[0]`); see
      `agent-model-config.md` for head-only `actuator` and flattening detail.
- [ ] `v2-architecture.md` cross-links `v2/docs/agent-model-config.md` for
      schema, validation, and loop detail (does not duplicate durable-home
      content).
- [ ] `v2/docs/role-resolution.md` cross-links `agent-model-config.md` for
      inner rung resolution instead of deferring to a follow-on slice.
- [ ] No thinking/reviewing/executing category appears as a model-resolution
      key in the edited architecture sections. (Manual)

## Documentation updates

- `v2/docs/v2-architecture.md` — short outer/inner composition overview;
  cross-link `agent-model-config.md`.
- `v2/docs/role-resolution.md` — replace inner-rung deferral with cross-link
  (minimal edit).
