---
name: estimate-api-spend-for-all-jarvis-use
---

# Estimate API spend for ALL jarvis use, every agent and operator, any provider

## Problem

Only claude records real `cost_usd`/`usage` (its stream-json emits usage inline; the claude adapter
parses it). Codex and cursor both record `usage_source: "unavailable"` with null cost/tokens — codex
writes usage to a rollout session file the adapter doesn't read, cursor's isn't parsed at all.
Operator-session cost is hand-pulled from `/cost`. Net effect: a heavy codex session (33 invocations
of `gpt-5.6-terra`/`sol` on 2026-07-17) was invisible in `reports/*.csv` — the operator only saw it
on the provider's own meter. Spend must be visible regardless of who provides the model.

## Decisions

- When actual usage is unavailable, ESTIMATE rather than record null: parse the agent's own usage
  artifact where one exists (codex rollout file; cursor usage output), else fall back to a
  token/duration estimate priced from `data/prices.json`. Rules out leaving spend as null.
- Add missing price rows (`gpt-5.6-terra`/`sol`/`luna`, cursor Composer). Rules out unpriceable models.
- Extend estimation to operator-session accounting so cost sheets reflect total jarvis spend. Rules
  out treating operator cost as out-of-band.
- Mark estimated figures as estimates (`cost_source`), distinct from measured. Rules out passing an
  estimate off as exact.

## Out of scope

- Cross-machine cost aggregation.

## Prerequisites

- Absorbs the estimation half of `codex-usage-from-invocation-stream` /
  `codex-unavailable-usage-is-diagnostic`.

## Documentation updates

- `v1/docs/operator-runbook.md` cost-reporting standard — estimated-cost fallback + operator coverage.
