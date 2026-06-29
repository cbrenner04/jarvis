---
name: register-opencode-deepseek-v4-pro
---

# Register opencode/deepseek-v4-pro for priced cost attribution

`{ agent: "opencode", model: "opencode/deepseek-v4-pro" }` already round-trips config
validation (`resolveOpencodePriceKey` returns the model verbatim). Without a
`data/prices.json` row, estimated-usage runs yield `cost_source: "no-price"` — same gap
`register-opencode-glm-5-2` closes for opencode models.

Operator opt-in: validation unchanged, `opencode run --model` receives the configured
string, session usage costs against the owner price row when the estimator path runs.

Owner pricing snapshot (2026-06-29):

```json
"opencode/deepseek-v4-pro": {
  "input_per_mtok": 1.74,
  "output_per_mtok": 3.48,
  "cache_read_per_mtok": 0.145,
  "source_url": "https://opencode.ai/zen/v1/models",
  "as_of": "2026-06-29"
}
```

## Decisions

- Registration-only — do not change default `agentOrder` or `DEFAULT_AGENT_MODELS` (`config.ts` stays `opencode/deepseek-v4-flash-free`); rules out promoting `opencode/deepseek-v4-pro` to the bootstrapped default.
- Add only the `opencode/deepseek-v4-pro` row to `data/prices.json` with the owner snapshot and cited `source_url`; rules out implementer-invented rates and rules out a codex-style `OPENCODE_PRICE_KEYS` allowlist change (`resolveOpencodePriceKey` already passes any model string).
- Omit `cache_write_per_mtok` from the owner row; rules out adding the field unless Zen lists a distinct rate at implementation time (`computeCost` falls back to `input_per_mtok`, matching `opencode/deepseek-v4-flash-free`).
- Keep `OPENCODE_MODEL_LABELS` empty; rules out a one-off friendly attribution label.
- Pass `opencode/deepseek-v4-pro` through to `opencode run --model` unchanged; rules out a preemptive alias map without CLI evidence.

## Out of scope

- Changing any mode's default `agentOrder`.
- Automatic free-tier rotation between DeepSeek V4 Pro and other opencode models — quota-cascade behavior, not registration.

## Documentation updates

None — registration-only opt-in; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update (net-new price row, not a change to existing default behavior).

## Prerequisites

- Owner-confirmed `opencode run --model opencode/deepseek-v4-pro` reachability (or record verified slug here if CLI differs).
