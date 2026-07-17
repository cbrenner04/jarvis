---
name: cursor-usage-is-untracked
---

# Cursor usage and cost are untracked (unlike claude), and it is not free

## Problem

Cursor (Composer 2.5) invocations record `cost_usd: null`, `usage_source: "unavailable"`, and null
token fields — the same hole as codex, but with **no** recovery procedure and **no** existing seed
(codex has `codex-usage-from-invocation-stream` + a runbook rollout-file correlation). Only claude's
usage is captured, because only claude's stream-json emits usage inline that the adapter parses.
Cursor is a **paid subscription**, not free — its spend is real but invisible in `reports/*.csv`;
the operator can only see it on the cursor.com meter. The "cursor is free" framing in the v1 runbook
(Observed actuator tiers) and memory is wrong and should be corrected.

## Decisions

- Parse cursor-agent usage output (or correlate a cursor session/usage artifact) in the cursor
  adapter and populate `cost_usd` / `usage.*`; rules out leaving cursor spend as null.
- Add cursor Composer pricing rows to `data/prices.json`; rules out an unpriceable actuator.
- Correct the "cursor is free" mislabel in `v1/docs/operator-runbook.md`; rules out steering
  operators to cursor as if it were cost-free.

## Out of scope

- General estimate-when-unavailable fallback (see `estimate-api-spend-for-all-jarvis-use`).

## Documentation updates

- `v1/docs/operator-runbook.md` — cursor is a paid subscription; its cost is tracked once this ships.
