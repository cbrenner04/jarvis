---
name: codex-usage-is-never-recorded
---

# Codex invocations record no usage, so a codex-led session has no agent cost

## Problem

Every codex row in `~/.jarvis/telemetry.jsonl` carries `cost_source: "unavailable"`,
`usage_source: "unavailable"`, and `cost_usd: null`. On 2026-08-02, 99 of 100 invocations were
codex, so the session's agent-cost column is empty — the one cursor row (`cost_source: "computed"`,
$0.18) is the entire measurable spend.

This is the same defect cursor had before #2431 (parse usage), #2433 (record it on telemetry),
and #2446 (compute list-price cost from `data/prices.json`). Those three shipped because
per-invocation cost is what the session report's cost table is built from. With codex as the
default lead agent, that table is now blank again.

Unlike cursor — subscription-billed, so list price is informational — codex is metered, which makes
the missing number an *actual* unbilled-spend figure the operator cannot see.

## Decisions

- Parse codex's reported token usage in the shared invocation adapter and stamp it on the telemetry
  row, mirroring the cursor path (`shared/invocation/`) — rules out a codex-specific telemetry
  shape.
- Compute `cost_usd` from `data/prices.json` for the resolved codex model, recording
  `cost_source: "computed"` when usage and a priced key settle, and the existing `no-price` /
  `no-usage` markers otherwise — rules out silently emitting `unavailable` for a metered agent.
- If codex reports billed cost directly, prefer it over the computed list price and record the
  distinction in `cost_source` — rules out reporting list price as invoiced spend.
- Out of scope: the price table's codex entries if they are absent (add them, but do not rework
  pricing), and any change to the cursor or claude paths.

## Acceptance criteria

- [ ] A codex invocation whose output reports usage records non-null `usage` with
      `usage_source: "agent"` on its telemetry row; a test fails against the current adapter.
- [ ] That row carries `cost_usd` computed from `data/prices.json` with `cost_source: "computed"`,
      matching the cursor computation for equivalent token counts.
- [ ] A codex invocation with no parseable usage still records `usage_source: "unavailable"` and a
      null `cost_usd`, without throwing.
- [ ] A model absent from `data/prices.json` records the existing `no-price` marker rather than a
      wrong number.
- [ ] Mutation checkpoint: dropping the codex usage parse turns the usage test RED, via a
      `// @mutate` directive in the pinning file.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows now carry usage and cost.

## Prerequisites

- The cursor usage/cost path shipped in #2431, #2433, #2446 (`shared/invocation/`, `data/prices.json`)
- Codex adapter output format (`shared/invocation/agents.ts`)
