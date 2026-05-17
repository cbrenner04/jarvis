# 03 - Agent-Model Price-Key Map

## Problem

Cost lookup uses the configured model id verbatim as the `data/prices.json` key:

- `src/modes/patch/run.ts` builds `pricingModelId = configuredPatchModelEntry?.model ?? agent.name`.
- `src/modes/plan/plan-telemetry.ts` builds `pricingModelId = opts.configuredModel ?? opts.agentCli`.
- Both pass that string through `extractUsageAndCost(..., pricingModelId)` to `computeCost`, which does a direct `prices.models[modelId]` lookup.

Config carries short, human-friendly model names (`src/config.ts`):

- `DEFAULT_AGENT_MODELS.claude = "haiku"`
- `DEFAULT_AGENT_MODELS.cursor = "Composer 2"`
- `DEFAULT_AGENT_MODELS.codex = "gpt-5.3-codex"`
- `DEFAULT_AGENT_MODELS.opencode = "github-copilot/claude-opus-4.7"`

`data/prices.json` keys are canonical model ids (`claude-haiku-4-5-20251001`, `claude-opus-4-7`, `gpt-5.3-codex`, ...). For most agents the configured value and the price key disagree, so cost lookup silently falls through to `no-price` and the summary reports cost as unavailable when a row exists.

## Decisions

- Add a per-agent **model → price-key** map, owned by each agent module (`src/agents/claude.ts`, `src/agents/codex.ts`, `src/agents/cursor.ts`, `src/agents/opencode.ts`, `src/agents/aider.ts`). Co-locating the map with the agent keeps each agent's model-name conventions next to the code that already knows them.
- Each agent exposes a `resolvePriceKey(model: string | undefined): string | null` function. Returning `null` means "this agent has no priced model for that configured value" and cost lookup should yield `no-price`. Do not silently fall back to the bare agent name.
- Expose a small registry, `src/agents/price-keys.ts`, that re-exports `resolvePriceKey` for each `AgentName` and provides a single `resolveAgentPriceKey(agent, model)` entry point. This is the only call site cost enrichment uses.
- Replace direct `pricingModelId = configuredModel ?? agent.name` construction in patch and plan with `resolveAgentPriceKey(agent.name, configuredModel)`. If the resolver returns `null`, `extractUsageAndCost` records `cost_source: "no-price"` (existing behavior, just reached on purpose instead of by accident).
- Validate at config load: for every entry in `modes.patch.agentOrder` and `modes.plan.agentOrder`, call `resolveAgentPriceKey(entry.agent, entry.model)`. If the agent has any priced models at all and the resolver returns `null` for the configured value, emit a clear config error pointing at the offending entry. The validator does not require a priced model to exist for every agent (cursor without estimation, opencode with provider-routed models may legitimately have no price); it only fails when the agent has a non-empty price-key map and the configured model is not in it.
- The validator produces a warning (not an error) when the agent has no entries in its map at all. The user knows that agent's costs are unavailable. This lets us land the map for claude/codex now without blocking cursor or opencode.
- Preserve backwards compatibility for legacy direct-keyed configurations: if the configured value already matches a `data/prices.json` key exactly, the resolver may return it as-is. Document this as a tie-breaker, not the primary path.
- Telemetry persistence does not change. Records continue to record `configured_model` (the value from config) for human-readable diagnostics. The resolved price key is an implementation detail of cost computation and need not be persisted.

## Tasks

- [ ] Add `resolvePriceKey` to each agent module with a map covering the models that agent's configs actually use today (`claude`: `haiku` → `claude-haiku-4-5-20251001`, `sonnet` → `claude-sonnet-4-6`, `opus` → `claude-opus-4-7`; `codex`: `gpt-5.3-codex` and `gpt-5.5` pass through; `cursor`: see subspec 04).
- [ ] Add `src/agents/price-keys.ts` exporting `resolveAgentPriceKey(agent, model)` and a typed registry of per-agent resolvers.
- [ ] Update `extractUsageAndCost` (or its callers) to call `resolveAgentPriceKey` and pass the resolved key to `computeCost`. Keep the existing `no-price` path unchanged.
- [ ] Update `src/modes/patch/run.ts` to drop the literal `configuredModel ?? agent.name` lookup in favor of `resolveAgentPriceKey`.
- [ ] Update `src/modes/plan/plan-telemetry.ts` likewise.
- [ ] Extend config validation (in `src/config.ts`) to run `resolveAgentPriceKey` over every `modes.*.agentOrder` entry and fail with a clear message when an agent that has any priced models is configured with an unknown model.
- [ ] Emit a one-time warning at config load if any configured agent has no price map entries at all (so the user knows cost will be unavailable for that agent).
- [ ] Add unit tests for each agent's `resolvePriceKey` covering known values, unknown values, and the exact-key passthrough tie-breaker.
- [ ] Add a config-validation test confirming a configured `claude` agent with model `"haiku"` resolves to a real price key and produces computed cost in `computeCost`.
- [ ] Add a config-validation test confirming an unknown `claude` model fails config load with a clear error.
- [ ] Update any existing tests that asserted `cost_source: "no-price"` for default-configured `claude`/`codex` runs; they should now assert `computed`.

## Acceptance criteria

- [ ] A default `jarvis run` using `claude` with model `"haiku"` produces a usage-bearing row with `cost_source: "computed"` and a non-null cost.
- [ ] A default `jarvis run` using `codex` with model `"gpt-5.3-codex"` continues to compute cost correctly.
- [ ] A configured `cursor` agent does not break config load even though cursor may have no priced rows yet (warning only).
- [ ] A configured `claude` model that does not appear in claude's price map (e.g. typo `"haiko"`) fails config load with a message that names the offending agent, model, and `modes.*` path.
- [ ] Telemetry continues to persist `configured_model` exactly as configured; price-key resolution is not visible in telemetry.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/run-loop.md` (or wherever cost-source semantics are described) to explain that configured model names are resolved through an agent-owned price-key map before cost lookup, and that a configured model with no map entry fails fast at config load.
