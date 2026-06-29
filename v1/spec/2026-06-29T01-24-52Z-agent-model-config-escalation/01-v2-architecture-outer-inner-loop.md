# v2-architecture outer/inner loop

## Problem

`v2/docs/v2-architecture.md` documents the agent/model split and
`(agent, role) → model` resolution at a high level but defers inner rung
escalation to the agent-model-config slice. Readers cannot see how outer
agent quota-fallback composes with inner per-role model rungs.

## Decisions

- **Edit per-project config in place** — add outer/inner loop composition;
  rules out a parallel escalation section elsewhere.
- **Cross-link `agent-model-config.md` for schema detail** — rules out
  duplicating `AgentModelConfig` types in architecture prose.
- **Outer loop semantics unchanged** — agent quota-fallback matches v1 agent
  availability chain — rules out role-driven agent reordering.
- **Inner loop is per `(agent, role)`** — landing on an agent resets to that
  agent's `rungs[0]` for the step's role — rules out carrying rung index across
  agents.
- **Replace "follow-on slice" / deferred inner-rung placeholders** in
  `role-resolution.md` step-binding section with a cross-link to
  `agent-model-config.md` — rules out leaving stale deferral prose after this
  slice lands.

## Task checklist

- Update `v2/docs/v2-architecture.md` per-project config: document two nested
  loops — outer agent quota-fallback; inner ordered model rungs per
  `(agent, role)` (quota-only advance; `model_config`/`error` terminal).
- State that inner rung exhaustion on an agent triggers outer fallback to the
  next agent (same role, that agent's `rungs[0]`).
- Cross-link `v2/docs/agent-model-config.md` for schema, validation, price
  derivation, and consumption modes.
- Update `v2/docs/role-resolution.md`: replace inner-rung deferral with
  cross-link to `agent-model-config.md` (schema home + consumption modes); keep
  role taxonomy ownership in `role-resolution.md`.

## Acceptance criteria

- [ ] `v2/docs/v2-architecture.md` per-project config documents outer agent
      quota-fallback and inner per-role model rung escalation as composed
      loops, with quota as the sole inner advance trigger.
- [ ] `v2-architecture.md` states `model_config` and `error` do not advance
      rungs or agents.
- [ ] `v2-architecture.md` cross-links `v2/docs/agent-model-config.md` for
      schema and validation detail.
- [ ] `v2/docs/role-resolution.md` cross-links `agent-model-config.md` for
      inner rung resolution instead of deferring to a follow-on slice.
- [ ] No thinking/reviewing/executing category appears as a model-resolution
      key in the edited architecture sections. (Manual)

## Documentation updates

- `v2/docs/v2-architecture.md` — outer/inner loop composition; cross-link
  `agent-model-config.md`.
- `v2/docs/role-resolution.md` — replace inner-rung deferral with cross-link
  (minimal edit).
