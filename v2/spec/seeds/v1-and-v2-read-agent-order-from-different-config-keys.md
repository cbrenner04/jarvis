---
name: v1-and-v2-read-agent-order-from-different-config-keys
---

# v1 and v2 read the agent order from different config keys, and editing the documented one silently changes nothing

## Problem

v1 reads `modes.<mode>.agentOrder` — ordered `{agent, model}` objects, per mode. v2 reads the flat top-level **`agents`** array of bare names (`v2/src/cli.ts` → `loadMachineConfig`) and never reads `modes.*.agentOrder`: `agentOrder` has **zero occurrences** anywhere under `v2/` or `shared/`.

So reordering `modes.*.agentOrder` — the lever `agents.md` and the v1 runbook document — changes v1 and **nothing about v2**, with no warning. Observed 2026-07-14: codex was moved to the front of every `modes.*.agentOrder` and every subsequent v2 run still invoked claude. Since v2 is the primary harness, the documented lever is the wrong one for almost all work now.

The failure is silent in the worst way: config edits appear to apply, runs proceed normally, and the only evidence is per-invocation telemetry showing an agent the operator did not select.

## History

Seeded originally under this same name and lost in the #1762 bulk backlog purge without the fix shipping. Re-seeded 2026-09-07 after a runbook audit found the citation dangling; re-verified against `main` (`grep -rn agentOrder v2/ shared/` → 0 hits).

## Decisions

- One key is authoritative for both engines; the other is accepted as a deprecated alias that is read, honored, and warned on rather than ignored; rules out two live keys that silently disagree.
- Given v1 is maintenance-only, the flat top-level `agents` list is the surviving surface and `modes.*.agentOrder` becomes the alias; rules out migrating the primary harness to the legacy shape.
- Loading a config that sets only the deprecated key emits a named warning on the operator's first command, naming both keys and the effective order; rules out a silent no-op edit.
- Loading a config that sets **both** keys with different orders is a named config error, not a precedence rule; rules out an operator having to remember which one wins.
- `jarvis config set-agents` remains the supported way to change it; docs stop pointing at hand-edited `modes.*.agentOrder` for v2; rules out documentation that describes a lever the primary harness does not read.

## Acceptance criteria

- [ ] A config-loading test proves a machine config setting only `modes.*.agentOrder` yields that order as v2's effective agent order and emits a named deprecation warning; it fails against the current silent ignore.
- [ ] A test proves a config setting both keys with conflicting orders fails with a named error identifying both keys; it fails against any silent-precedence behavior.
- [ ] A test proves a config setting only the top-level `agents` array behaves exactly as today, with no warning.
- [ ] A guard test proves no production module under `v2/` or `shared/` reads `modes.*.agentOrder` directly, so the alias resolves in one place.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` and `v2/docs/install-and-config.md` — the authoritative key and the deprecation.
- `v2/docs/operator-runbook.md` — retire the divergence gotcha.
- `v1/docs/config.md` — note the alias for the maintenance engine.
- `v2/docs/v1-behaviors.md` — record the unified resolution.
