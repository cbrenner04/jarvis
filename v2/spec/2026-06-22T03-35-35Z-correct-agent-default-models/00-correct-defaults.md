# Correct codex and cursor default models

## Problem

`DEFAULT_AGENT_MODELS` (`v1/src/config.ts:126-127`) ships two stale defaults:

- `codex: "gpt-5.3-codex"` — unreachable (OpenAI pulled subscription access) and unpriced (`resolveCodexPriceKey` → `"gpt-5.3-codex"`, absent from `data/prices.json` → `no-price`). Codex-as-fallback defaults to a model it cannot run and cannot cost.
- `cursor: "Composer 2"` — `Composer 2.5` is strictly better at identical price (`input 0.5 / output 2.5`, both rows in `data/prices.json`).

## Decisions

- codex default → `gpt-5.4` — reachable + already priced. Rules out `gpt-5.5` (newer/pricier, not the established fallback tier).
- cursor default → `Composer 2.5`. Changing the requested model **string** is what switches the model; the `cursor.ts` price-key alias only maps cost.
- Keep the `cursor.ts` `"Composer 2" → composer-2.5` price-key alias (`v1/src/agents/cursor.ts:43`). Rules out deleting it — it still prices legacy configs that pin `Composer 2`.
- Do **not** add a codex/OpenAI `gpt-5.3-codex` price entry. `gpt-5.3-codex` is cursor-only now; its Cursor `GPT-5.3 Codex` price row stays. Rules out re-pricing it under codex to make the old default reachable.

## Task checklist

- [ ] `config.ts:126-127`: `codex` → `gpt-5.4`, `cursor` → `Composer 2.5`.
- [ ] Update tests that pin the default agent order / models (e.g. `v1/test/config.test.ts` `DEFAULT_AGENT_ORDER` + default-bootstrap assertions, and any other default-config assertions across `v1/test`). Test inputs that deliberately exercise overrides with arbitrary model strings need not change.
- [ ] Docs: `v1/docs/agents.md` default-order references; `v2/docs/v1-behaviors.md` lines pinning the default models.

## Acceptance criteria

- [ ] A freshly bootstrapped config's default `modes.patch.agentOrder` (and `modes.plan`/`modes.prompt`) lists `codex` with model `gpt-5.4` and `cursor` with model `Composer 2.5`; no default entry references `gpt-5.3-codex` or `Composer 2`.
- [ ] `data/prices.json` has no codex/OpenAI `gpt-5.3-codex` entry added; the existing Cursor `GPT-5.3 Codex` and `Composer 2` rows are unchanged.
- [ ] `cursor.ts` still resolves a `Composer 2` model string to the `composer-2.5` price key (legacy alias preserved).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: corrected default-order examples show `codex`/`gpt-5.4` and `cursor`/`Composer 2.5`.
- `v2/docs/v1-behaviors.md`: default `agentOrder` entries record `codex` (`gpt-5.4`) and `cursor` (`Composer 2.5`).
