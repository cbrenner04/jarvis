---
name: register-codex-gpt-5-4-mini
---

# Register gpt-5.4-mini as a codex model option

`agentOrder` entries `{ agent: "codex", model: "gpt-5.4-mini" }` are rejected today
because `CODEX_PRICE_KEYS` omits the model and `data/prices.json` has no row.

Operator can opt in via `jarvis config` (or hand-edited config): validation accepts
the entry, `codex exec` receives the correct `--model` value, and correlated session
usage costs against the new price row — same path as `gpt-5.4` / `gpt-5.5`.

Owner pricing snapshot (2026-06-27):

```json
"gpt-5.4-mini": {
  "input_per_mtok": 0.75,
  "output_per_mtok": 4.5,
  "cache_read_per_mtok": 0.075,
  "source_url": "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
  "as_of": "2026-06-27"
}
```

## Decisions

- Registration-only — do not change default `agentOrder` or `DEFAULT_AGENT_MODELS`; rules out promoting `gpt-5.4-mini` to the bootstrapped default.
- Add `gpt-5.4-mini` to `CODEX_PRICE_KEYS` and `data/prices.json` together — rules out a prices-only row that still fails config validation.
- Use the owner pricing snapshot above with cited `source_url` — rules out implementer-invented rates.
- Omit `CODEX_MODEL_LABELS` entry — existing codex models use raw model strings for attribution; rules out a one-off friendly label.
- Pass config model string through to `codex exec --model` unless CLI inspection shows a different slug — rules out preemptive alias map without evidence.
- Deferred to first consumer: whether `gpt-5.4-mini` draws separate quota from `gpt-5.4` — pin when operator needs quota-tier guidance.

## Out of scope

- Changing default `agentOrder` for any mode.
- Quota-pool documentation or classification beyond what codex stderr already provides.

## Prerequisites
