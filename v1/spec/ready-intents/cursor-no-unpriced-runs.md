---
name: cursor-no-unpriced-runs
---

# Every cursor run resolves to a price key

A successful cursor iteration with estimated or measured usage never ends with
`cost_source: "no-price"` because the model lacks a `data/prices.json` row.

`CURSOR_KNOWN_MODELS`, CLI slug→label mapping, and `prices.json` stay aligned
so every cursor model jarvis can select resolves a price key. Subscription-
included models (e.g. Composer 2.5) use a reference/notional row with published
per-token rates — missing entry is a harness bug, not an operator gap.

Regression: configured cursor model with usage present always yields
`cost_source` `estimated`, `computed`, or `agent`, never `no-price`.

## Decisions

- Reference/notional `prices.json` rows for known cursor models instead of accepting `no-price` — rules out treating missing rows as normal for cursor-known models.
- Unknown models outside `CURSOR_KNOWN_MODELS` may still yield `no-price` — rules out inventing price keys for models cursor adds without a harness update.

## Out of scope

- Measured-usage spike or adapter correlation work.
- Segmentation or imputed-notional reporting.

## Prerequisites
