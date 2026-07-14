---
name: v1-and-v2-read-agent-order-from-different-config-keys
---

# v1 and v2 take their agent order from different config keys, so changing it changes only one of them

The same `~/.jarvis/config.json` is read two ways:

- **v1** uses `modes.<mode>.agentOrder` — an ordered array of `{agent, model}` objects, per mode
  (`patch`, `plan`, `review`, `prompt`), plus `modes.patch.subRoleAgentOrder.{reviewPanel,reviewActuator}`.
- **v2** uses the flat top-level **`agents`** array of bare agent names
  (`v2/src/cli.ts:236` / `:662` → `loadMachineConfig` → `parsed.agents`,
  `v2/src/config/machine-config-loader.ts:65`). It never reads `modes.*.agentOrder`.

So an operator who reorders `modes.*.agentOrder` — the documented lever, and the only one the v1
runbook and `agents.md` describe — changes v1's behavior and **nothing about v2**. The v2 runs keep
using the old order, silently, with no warning and no diagnostic. The two keys can disagree
indefinitely.

Observed 2026-07-14: the operator moved `codex` to the front of every `modes.*.agentOrder` to trial
it as primary, restarted the daemon, and launched v2 plan and implement runs. Every one still
invoked `claude` (telemetry `agent: "claude"` on all four post-change invocations). The change had
no effect on v2 because `agents` still read `["claude", "codex", "cursor"]`. This was initially
misdiagnosed as daemon config staleness; it is not — v2 resolves the order **CLI-side at launch**,
correctly and immediately, from a key nobody thought to edit.

## Decisions

- v2 reads the same per-mode `agentOrder` v1 does, so one edit moves both. Rules out documenting two
  keys and asking the operator to keep them in sync — that is the bug, restated.
- The flat `agents` array stays supported as the fallback when no mode-specific order is configured,
  so existing configs keep working. Rules out a breaking config migration.
- Where both are present and disagree, `agentOrder` wins and v2 does not silently prefer `agents`.
- Rules out: a `jarvis config` warning about divergence. Warning about a split that should not exist
  is worse than closing it.

## Prerequisites

- None.

## Out of scope

- Per-agent model selection in v2 (`agent-model-config.ts`) — models, not order.
- Adding a `--agent` per-run override to v2 (separate gap; v1 has one, v2 does not).

## Documentation updates

- `v1/docs/agents.md` — the agent-order section describes only `modes.*.agentOrder`; it is currently
  wrong for v2.
- `v2/docs/install-and-config.md` — states which key drives v2's order.
- `v2/docs/operator-runbook.md` § Choosing an actuator — the per-run override advice it gives is v1
  syntax that does nothing in v2.
