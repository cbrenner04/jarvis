# `shared/invocation` records no cost and cannot observe claude's output

Every v2 agent invocation records `cost_usd: null` / `usage_source: "unavailable"`. **Cost
attribution goes dark for all v2 work**, and the same root cause reintroduces the claude
idle-watchdog blindness that `claude-streams-output-to-watchdog` was supposed to have fixed.

## Problem

Observed 2026-07-13. In one session:

- **`runs.jsonl`** (v1) carried cost normally: the single `jarvis1 run` this session recorded
  **$6.84** across 8 records.
- **`telemetry.jsonl`** (v2) carried **133 claude invocations with `cost_usd: null`,
  `cost_source: unavailable`, `usage_source: unavailable`, and every `usage.*_tokens: null`** —
  the plan, the implement, both intent splits, and the debate. Not one dollar attributable.

Prior sessions reported cost fine because the work was v1-driven. **As dogfooding shifts to
v2, the cost sheets stop working** — `reports/session-costs.csv` cannot be filled from
`runs.jsonl` for any v2 run, because v2 does not write to it.

The mechanism is in `shared/invocation/agents.ts`:

- Line ~427 spawns claude with `--output-format json` — the **batch envelope**.
- `v1/src/agents/claude.ts:68` was changed to `--output-format stream-json --verbose` by
  `claude-streams-output-to-watchdog` (#1450). **That fix was never propagated to `shared/`.**
- `parseClaudeJsonOutput` (`shared/invocation/claude-json.ts`) then yields `usage: null` and
  `cost_usd: null`, so `agents.ts:395-402` never populates either field, and the row falls
  through to `usage_source: "unavailable"`.

So the two harms share one cause:

1. **Cost is unrecordable for every v2 run.**
2. **The idle-output watchdog is structurally blind to claude in v2** — the batch envelope is
   emitted once at exit, so `stdout.on("data")` never bumps mid-invocation. This is exactly
   the defect that produced 33/33 `last_output_age_ms: null` records in v1 and got
   misdiagnosed twice as "claude-haiku stalls on pool contention" and "claude-sonnet-5 is too
   slow." v1 is fixed; **v2 still has it**, and now leads with claude in its agent order.

## Decisions

- **`shared/invocation` spawns claude the way v1 does** — `stream-json --verbose` — and parses
  the terminal `type: "result"` event for `displayText`, `usage`, and `cost_usd`. Rules out
  fixing cost alone and leaving the watchdog blind, or vice versa; it is one flag and one
  parser.
- **A fix that lands in `v1/src/agents/` and not `shared/invocation/` is incomplete by
  default.** These are two claude adapters with one contract; the next agent-behavior fix will
  hit this again unless they converge.
- Cost must be attributable per invocation for v2 runs, on the same identity
  (`namespace`/`run_id`) the cost sheets join on.

## Prerequisites

- None. `v1/src/agents/claude-json.ts` is the reference implementation to port.

## Out of scope

- Codex session-usage resolution (`resolveCodexSessionUsage`) — a separate path.
- Whether v2 should write `runs.jsonl` or the cost sheets should read `telemetry.jsonl`;
  either satisfies this, pick one at plan time.

## Documentation updates

- `v1/docs/operator-runbook.md` § Cost reporting standard — name the v2 source once it works.
- `v2/docs/operator-runbook.md` — remove the claude-is-safe-as-primary claim until this ships;
  v2's watchdog cannot see claude.
