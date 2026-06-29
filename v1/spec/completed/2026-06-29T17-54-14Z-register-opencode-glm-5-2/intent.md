---
name: register-opencode-glm-5-2
---

# Register opencode/glm-5.2 for priced cost attribution

`{ agent: "opencode", model: "opencode/glm-5.2" }` already round-trips config validation
(`resolveOpencodePriceKey` returns the model verbatim). Without a `data/prices.json` row,
estimated-usage runs yield `cost_source: "no-price"` — same gap `register-codex-gpt-5-4-mini`
closed for codex.

Operator opt-in: validation unchanged, `opencode run --model` receives the configured
string, session usage costs against the owner price row when the estimator path runs.

Owner pricing snapshot (2026-06-28):

```json
"opencode/glm-5.2": {
  "input_per_mtok": 1.40,
  "output_per_mtok": 4.40,
  "cache_read_per_mtok": 0.26,
  "source_url": "https://opencode.ai/zen/v1/models",
  "as_of": "2026-06-28"
}
```

## Decisions

- Registration-only — do not change default `agentOrder` or `DEFAULT_AGENT_MODELS` (`config.ts:142` stays `opencode/deepseek-v4-flash-free`); rules out promoting `opencode/glm-5.2` to the bootstrapped default.
- Add only the `opencode/glm-5.2` row to `data/prices.json` with the owner snapshot and cited `source_url`; rules out implementer-invented rates and rules out a codex-style `OPENCODE_PRICE_KEYS` allowlist change (`resolveOpencodePriceKey` already passes any model string).
- Keep `OPENCODE_MODEL_LABELS` empty; rules out a one-off friendly attribution label.
- Pass the configured model string through to `opencode run --model` unless CLI inspection shows a different slug; rules out a preemptive alias map without evidence.
- Deferred to first consumer: automatic free-tier rotation between GLM 5.2 and DeepSeek V4 Flash Free — pin when quota-cascade intents need it.

## Out of scope

- Automatic free-tier rotation (GLM allotment exhaustion → DeepSeek fallback) — quota-cascade behavior, not registration.
- Changing any mode's default `agentOrder`.

## Documentation updates

None — registration-only opt-in; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update (net-new price row, not a change to existing default behavior).

## Prerequisites

- Owner-confirmed `opencode run --model opencode/glm-5.2` reachability (or record verified slug here if CLI differs).
