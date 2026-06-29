# Quota precedes model_config at spawn

## Problem

`v1/src/agents/spawn.ts` classifies non-zero exits **transient → auth →
model_config → quota**. When merged diagnostics match both a per-agent strict
quota pattern and a `model_configuration` pattern (e.g. codex `You've reached
your usage limit` alongside incidental config-error noise such as
`shell_snapshot validation failed … syntax error near unexpected token '('`),
`model_config` wins and masks quota. Downstream cascades that rotate only on
`quota` never try the next agent.

## Decisions

- Spawn classification order becomes **transient → auth → quota → model_config** — rules out keeping `model_config → quota`, which lets co-occurring signals mask quota.
- Precedence change lives in `spawn.ts` only (reorder branches or equivalent) — rules out widening mode-layer `shouldAdvance` to treat masked `model_config` as quota.
- Do not rely on narrowing `modelConfigurationPatterns` alone — rules out a pattern-only fix that leaves precedence wrong for future co-occurring noise.
- Genuine model-id misconfiguration with no strict quota signal stays `model_config`.
- Transient and auth precedence are unchanged: transient still wins over auth; auth still wins over quota.

## Task checklist

- [ ] Reorder spawn classification in `v1/src/agents/spawn.ts` so strict quota is checked before `isModelConfigurationSignal`.
- [ ] Extend `v1/test/agents/spawn-classification.test.ts`: co-occurring strict-quota + model-config stderr → `kind: "quota"`; rename the describe block to the new order.
- [ ] Update `v1/docs/quota-signals.md`: spawn classification order; matrix row for co-occurring strict-quota + model-config signals.
- [ ] Update `v1/docs/agent-cli-failure-pipeline.md`: spawn precedence list (include transient/auth; quota before model_config).
- [ ] Update `v2/docs/v1-behaviors.md`: spawn classification order note.

## Acceptance criteria

- [ ] Non-zero exit whose merged diagnostics match both a per-agent strict quota pattern and a model-configuration pattern classifies as `kind: "quota"` (not `model_config`) at spawn — verified in `v1/test/agents/spawn-classification.test.ts`.
- [ ] Genuine model-id misconfiguration with no strict quota signal still classifies as `kind: "model_config"` — `v1/test/agents/spawn-classification.test.ts` (`genuine model-id misconfiguration stays model_config`) stays green.
- [ ] Strict quota-only and auth/transient precedence cases in `v1/test/agents/spawn-classification.test.ts` stay green.
- [ ] Per-agent `model_config`-only adapter tests stay green: `v1/test/agents/claude.test.ts`, `v1/test/agents/codex.test.ts`, `v1/test/agents/cursor.test.ts`, `v1/test/agents/opencode.test.ts`, `v1/test/agents/aider.test.ts`.
- [ ] `v1/docs/quota-signals.md` documents spawn order **transient → auth → quota → model_config** and includes a matrix row mapping co-occurring strict-quota + model-config diagnostics to `quota` with rotate-to-next behavior.
- [ ] `v1/docs/agent-cli-failure-pipeline.md` and `v2/docs/v1-behaviors.md` match the new spawn precedence.

## Documentation updates

- `v1/docs/quota-signals.md` — classification order and matrix row for co-occurring signals.
- `v1/docs/agent-cli-failure-pipeline.md` — spawn precedence list.
- `v2/docs/v1-behaviors.md` — spawn classification order note.
