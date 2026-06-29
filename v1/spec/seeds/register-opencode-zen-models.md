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

## Resolved inputs (owner-provided 2026-06-28)

- **Slug:** `opencode/glm-5.2` (zen model id `glm-5.2`, `owned_by: opencode`).
- **Pricing** (metered — GLM 5.2 is not free; allotment-limited):

  ```json
  "opencode/glm-5.2": {
    "input_per_mtok": 1.40,
    "output_per_mtok": 4.40,
    "cache_read_per_mtok": 0.26,
    "source_url": "https://opencode.ai/zen/v1/models",
    "as_of": "2026-06-28"
  }
  ```

- **opencode auth/access** is set up owner-side (`opencode auth`); the model is reachable.

Note: config validation already accepts `opencode/glm-5.2` without this row
(`resolveOpencodePriceKey` returns the model verbatim) — so an operator can select it
today; the row only fixes cost attribution (avoids an unpriced run).

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
