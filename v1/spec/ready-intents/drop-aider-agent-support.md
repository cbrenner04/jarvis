---
name: drop-aider-agent-support
---

# Remove aider agent support from the harness

## Behavior

`aider` is no longer a supported agent CLI. It is removed end to end:
adapter (`v1/src/agents/aider.ts`), factory registration, agent-type entry,
default model, price keys, and quota classification. The agent-adapter
interface and fallback-ladder mechanics are unchanged; no other agent
(`codex`/`cursor`/`opencode`) is touched.

Docs drop aider: delete `v1/docs/aider-model-warnings.md` and strip aider
from `agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`,
`quota-signals.md`.

Tests drop aider: remove `v1/test/agents/aider.test.ts` and aider
cases/fixtures in `price-keys.test.ts`, `quota.test.ts`, `config.test.ts`,
`run.test.ts`, `telemetry-enrichment.test.ts`, and the plan command tests.

`grep -rin aider` returns clean (outside historical reports); suite and
typecheck stay green.

## Out of scope

- Removing any other agent.
- Changing the agent-adapter interface or fallback-ladder mechanics.

## Prerequisites
