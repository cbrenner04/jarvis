---
name: drop-aider-agent-support
---

# Remove aider agent support from the harness

## Problem

`aider` is a supported agent CLI in the harness but the operator doesn't use it,
and it has been removed from all `~/.jarvis/config.json` agentOrders (review's
last fallback is now `opencode`). It remains dead surface across ~20 files —
adapter, factory registration, types, price keys, quota classification, a
dedicated warnings doc, and scattered doc/test references — pure maintenance cost
with no consumer.

## Direction

Remove aider end to end and verify zero residual references:

- Adapter + wiring: `v1/src/agents/aider.ts`, factory registration
  (`v1/src/agents/factory.ts`), agent-type entry (`v1/src/agents/types.ts`),
  default model (`v1/src/config.ts`), price keys (`v1/src/agents/price-keys.ts`),
  quota classification (`v1/src/agents/quota.ts`).
- Docs: delete `v1/docs/aider-model-warnings.md`; strip aider from
  `agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, `quota-signals.md`.
- Tests: remove `v1/test/agents/aider.test.ts` and aider cases/fixtures in
  `price-keys.test.ts`, `quota.test.ts`, `config.test.ts`, `run.test.ts`,
  `telemetry-enrichment.test.ts`, the plan command tests, etc.
- `grep -rin aider` must come back clean (outside historical reports); suite and
  typecheck stay green.

## Out of scope

- Removing any other agent (`codex`/`cursor`/`opencode`).
- Changing the agent-adapter interface or fallback-ladder mechanics.

## References

- Footprint (~20 files): `v1/src/agents/aider.ts`, `factory.ts`, `types.ts`,
  `price-keys.ts`, `quota.ts`, `config.ts`; `v1/docs/aider-model-warnings.md`
  plus 5 other docs; `v1/test/agents/aider.test.ts` plus ~7 other test files.
