---
name: register-opencode-zen-models
---

# Register opencode zen models (GLM 5.2 + free-tier rotation)

Config validation (`v1/src/config.ts:642`) only accepts an `agentOrder` model that
is a **known priced model** — it must have a row in `data/prices.json`. Today only
`opencode/deepseek-v4-flash-free` is registered. The opencode zen catalog
(<https://opencode.ai/zen/v1/models>) offers other free/cheap rungs the operator wants
to tier through as free models rotate (GLM 5.2 today; reverts to DeepSeek V4 Flash Free
when GLM's free allotment runs out). Each new rung must be registered before it can be
selected — same gap that `register-codex-gpt-5-4-mini` fixes for codex.

Register `opencode/glm-5.2` (exact zen slug TBD by owner) so an operator can set
`{ agent: "opencode", model: "opencode/glm-5.2" }` and have validation accept it,
`opencode run` receive the model, and usage cost against its price row.

## Owner help required (not implementable until provided)

- **Exact zen model slug** for GLM 5.2 as `opencode run --model` expects it
  (e.g. `opencode/glm-5.2` vs a vendor-prefixed form) — confirm from the zen catalog.
- **Pricing snapshot** (input/output/cache per-mtok + `source_url` + `as_of`). Zen
  free models are `0`/`0` like the DeepSeek row; if GLM 5.2 is metered after a free
  allotment, capture the metered rates.
- **opencode auth/access** for zen GLM is an opencode-side setup step (operator runs
  `opencode auth`), not harness work — but note it in the seed so the registration
  isn't merged before the model is actually reachable.

## Decisions

- Registration-only — do **not** change default `agentOrder` or `DEFAULT_AGENT_MODELS`
  (`config.ts:142` stays `opencode/deepseek-v4-flash-free`). Operator opts in by hand.
- Add the `opencode/glm-5.2` row to `data/prices.json` with the owner pricing snapshot
  and cited `source_url` — rules out implementer-invented rates.
- Pass the config model string straight to `opencode run --model` unless CLI inspection
  shows a different slug — rules out a preemptive alias map.
- Keep `OPENCODE_MODEL_LABELS` empty (raw model string for attribution) — matches the
  existing opencode model handling.

## Out of scope

- Automatic free-tier rotation (detecting GLM allotment exhaustion and falling back to
  DeepSeek) — that is quota-cascade behavior, covered by the `spawn-quota` /
  `plan-cascade` / `watchdog` cascade intents, not registration. This seed only makes
  the rungs *selectable*.
- Changing any mode's default `agentOrder`.

## Documentation updates

- None beyond the price row + any inline comment near `config.ts` opencode default.
