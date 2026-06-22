# Correct codex and cursor default models

## Problem

`DEFAULT_AGENT_MODELS` (`v1/src/config.ts:126-127`) ships two stale defaults:

- `codex: "gpt-5.3-codex"` — unreachable (OpenAI pulled subscription access) and unpriced (`resolveCodexPriceKey` → `"gpt-5.3-codex"`, absent from `data/prices.json` → `no-price`). Codex-as-fallback defaults to a model it cannot run and cannot cost.
- `cursor: "Composer 2"` — `Composer 2.5` is strictly better at identical price (`input 0.5 / output 2.5`, both rows in `data/prices.json`).

## Decisions

- codex default → `gpt-5.4` — reachable + already priced. Rules out `gpt-5.5` (newer/pricier, not the established fallback tier).
- cursor default → `Composer 2.5`. Changing the requested model **string** is what switches the model.
- Two cursor maps, do not conflate: the **CLI-invocation slug map** (`"Composer 2" → composer-2.5`, what the CLI actually runs) and a **separate identity price-key map** (a `Composer 2` string prices via the `Composer 2` row, never `composer-2.5`; pinned by a test asserting `resolveAgentPriceKey("cursor", "Composer 2") === "Composer 2"`).
- Keep the `cursor.ts` `"Composer 2" → composer-2.5` CLI-slug entry (`v1/src/agents/cursor.ts:43`). Rules out deleting it — a config pinned to `Composer 2` keeps running the better `composer-2.5` model. (Legacy `Composer 2` *pricing* survives independently via the unchanged `Composer 2` price row, not via this entry.)
- Do **not** add a codex/OpenAI `gpt-5.3-codex` price entry. `gpt-5.3-codex` is cursor-only now; its Cursor `GPT-5.3 Codex` price row stays. Rules out re-pricing it under codex to make the old default reachable.

## Task checklist

- [x] `config.ts:126-127`: `codex` → `gpt-5.4`, `cursor` → `Composer 2.5`.
- [x] Update test assertions **derived from `DEFAULT_AGENT_ORDER`/bootstrap defaults**; leave fixtures that pin arbitrary model strings to exercise overrides. Confirmed must-change sites: `v1/test/config.test.ts` `DEFAULT_AGENT_ORDER` + default-bootstrap assertions. Apply the rule to any other default-derived assertion across `v1/test` (do not rely on `bun run test` failures to surface them — override fixtures and stale non-default-block assertions can both stay green).
- [x] Classify the run-summary rendered-output assertion printing `codex (gpt-5.3-codex)`: if its input is default-derived, update to `gpt-5.4`; if it's an override fixture, leave it.
- [x] Docs (all four stale spots): `v1/docs/agents.md` — the two JSON default-order examples; `v2/docs/v1-behaviors.md` — the table row and the prose line pinning the default models.

## Acceptance criteria

- [x] A freshly bootstrapped config's default `modes.patch.agentOrder` (and `modes.plan`/`modes.prompt`) lists `codex` with model `gpt-5.4` and `cursor` with model `Composer 2.5`; no default entry references `gpt-5.3-codex` or `Composer 2`.
- [x] `data/prices.json` has no codex/OpenAI `gpt-5.3-codex` entry added; the existing Cursor `GPT-5.3 Codex` and `Composer 2` rows are unchanged.
- [x] `cursor.ts` still maps the `Composer 2` model string to the `composer-2.5` CLI-invocation slug — a config pinned to `Composer 2` keeps running `composer-2.5`. The existing test asserting `resolveAgentPriceKey("cursor", "Composer 2") === "Composer 2"` (identity price key) stays green.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agents.md`: both JSON default-order examples show `codex`/`gpt-5.4` and `cursor`/`Composer 2.5`.
- `v2/docs/v1-behaviors.md` (mandatory — this changes existing v1 behavior): update both the table row and the prose line pinning the default models to `codex` (`gpt-5.4`) and `cursor` (`Composer 2.5`).
