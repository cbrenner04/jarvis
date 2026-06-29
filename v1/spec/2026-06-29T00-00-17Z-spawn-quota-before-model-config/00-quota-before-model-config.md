# Quota precedes model_config at spawn

## Problem

`v1/src/agents/spawn.ts` classifies non-zero exits in `checkSettlement` as
**transient → auth → model_config → quota**. When merged diagnostics match both
a per-agent **strict** quota pattern (`isQuotaSignal`) and a real
model-configuration pattern (`isModelConfigurationSignal`) — e.g. codex
`You've reached your usage limit` plus `unknown model` — `model_config` wins and
masks quota. Downstream cascades that rotate only on `quota` never try the next
agent.

Illustrative only (not a `modelConfigurationPatterns` match): codex
`shell_snapshot validation failed … syntax error near unexpected token '('` may
appear alongside quota stderr; the reproducible bug is strict-quota +
model-config pattern co-occurrence.

## Decisions

- Spawn classification order becomes **transient → auth → quota → model_config** — rules out keeping `model_config → quota`, which lets co-occurring signals mask quota.
- **Strict quota only at spawn** wins over `model_config` when both match — rules out weak-quota / lenient-upgrade text winning at settlement.
- **Auth + strict quota + model_config** → `quota` with `authFailure: true` (auth branch first) — rules out quota or `model_config` winning when durable auth also matches.
- **Transient + strict quota** co-occurrence unchanged (transient still wins) — rules out expanding this subspec to reorder transient vs quota.
- Precedence change lives in `spawn.ts` only (reorder branches or equivalent) — rules out widening mode-layer `shouldAdvance` to treat masked `model_config` as quota.
- Do not rely on narrowing `modelConfigurationPatterns` alone — rules out a pattern-only fix that leaves precedence wrong for future co-occurring noise.
- Genuine model-id misconfiguration with no strict quota signal stays `model_config`.

## Out of scope

- Claude exit-0 adapter reclassification.
- `shouldAdvance` / mode-layer cascade policy.
- Transient-vs-quota precedence change.
- Operator shell rc fix for codex snapshot warnings.

## Task checklist

- [ ] Reorder spawn classification in `v1/src/agents/spawn.ts` so strict quota is checked before `isModelConfigurationSignal`; update the classification-order comment (~line 90).
- [ ] Extend `v1/test/agents/spawn-classification.test.ts`: codex fixture whose stderr matches both `isQuotaSignal` (strict, e.g. `You've reached your usage limit`) and `isModelConfigurationSignal` (e.g. `unknown model`) → `kind: "quota"`; rename the describe block to the new order.
- [ ] Update `v1/docs/quota-signals.md`: co-occurrence matrix row (dual strict-quota + model-config → `quota`, rotate immediately; patch/plan/exit/telemetry same as strict-quota row); short spawn-order line cross-linking [agent-cli-failure-pipeline.md](agent-cli-failure-pipeline.md) — no second full precedence list.
- [ ] Update `v1/docs/agent-cli-failure-pipeline.md` (canonical spawn order home): step 3 — full `checkSettlement` order (**transient → auth → quota → model_config**); step 4 — transient cap **3 re-attempts (4 total spawns)**; clarify classification (step 3) vs post-settlement transient retry in `runAgent` (step 4) are separate — not one combined precedence chain.
- [ ] Update `v2/docs/v1-behaviors.md`: both spawn-order bullets (Quota detection ~292, Agent-failure pipeline ~402) to **transient → auth → quota → model_config**; co-occurrence note — dual strict-quota + model-config match → `quota`, not `model_config`.

## Acceptance criteria

- [x] Non-zero exit whose merged diagnostics match both a per-agent strict quota pattern and a model-configuration pattern classifies as `kind: "quota"` (not `model_config`) at spawn — codex fixture in `v1/test/agents/spawn-classification.test.ts` exercising both `isQuotaSignal` and `isModelConfigurationSignal` (not `shell_snapshot` noise).
- [x] Genuine model-id misconfiguration with no strict quota signal still classifies as `kind: "model_config"` — `v1/test/agents/spawn-classification.test.ts` (`genuine model-id misconfiguration stays model_config`) stays green.
- [x] Strict quota-only and auth/transient precedence cases in `v1/test/agents/spawn-classification.test.ts` stay green.
- [x] Per-agent `model_config`-only adapter tests stay green: `v1/test/agents/claude.test.ts`, `v1/test/agents/codex.test.ts`, `v1/test/agents/cursor.test.ts`, `v1/test/agents/opencode.test.ts`, `v1/test/agents/aider.test.ts`.
- [x] `v1/docs/quota-signals.md` includes the co-occurrence matrix row and a short spawn-order line cross-linking `v1/docs/agent-cli-failure-pipeline.md` (no duplicated full precedence list).
- [x] `v1/docs/agent-cli-failure-pipeline.md` documents step 3 full spawn order, step 4 transient cap (3 re-attempts / 4 total spawns), and classification-vs-retry separation.
- [x] `v2/docs/v1-behaviors.md` updates both spawn-order bullets to **transient → auth → quota → model_config** and notes dual-match → `quota`.

## Documentation updates

- `v1/docs/quota-signals.md` — co-occurrence matrix row; short order line cross-linking pipeline.
- `v1/docs/agent-cli-failure-pipeline.md` — canonical full spawn classification order; step 4 cap; classification vs transient-retry separation.
- `v2/docs/v1-behaviors.md` — both spawn-order bullets; co-occurrence note.
