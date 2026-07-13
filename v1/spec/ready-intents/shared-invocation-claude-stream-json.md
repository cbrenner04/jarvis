---
name: shared-invocation-claude-stream-json
---

# `shared/invocation` spawns claude with stream-json and records cost + live output

`shared/invocation/agents.ts` spawns claude with `--output-format json` (batch envelope). Two harms, one cause:

1. `parseClaudeJsonOutput` yields `usage: null` / `cost_usd: null`, so every v2 invocation lands as `cost_usd: null`, `cost_source: unavailable`, `usage_source: unavailable`. Observed 2026-07-13: 16/16 real invocations in one session, zero dollars attributable.
2. The batch envelope arrives once at exit, so the idle-output watchdog never sees mid-invocation stdout — the exact blindness `claude-streams-output-to-watchdog` (#1450) fixed in `v1/src/agents/claude.ts:68`, never propagated to `shared/`. v2 leads with claude in its agent order.

## Decisions

- Spawn claude as v1 does: `--output-format stream-json --verbose`; parse the terminal `type: "result"` event for `displayText`, `usage`, `cost_usd`. Rules out fixing cost alone (watchdog stays blind) or the watchdog alone (cost stays dark) — it is one flag and one parser.
- Stream events must bump the watchdog's last-output timestamp as they arrive, not at exit; a v2 claude invocation records a non-null `last_output_age_ms`.
- Port from `v1/src/agents/claude-json.ts` rather than re-derive the envelope shape.

## Out of scope

- Codex session-usage resolution (`resolveCodexSessionUsage`).
- Where the cost sheets read v2 cost from.

## Documentation updates

- `v2/docs/operator-runbook.md` — the claude-is-safe-as-primary claim is only true once this ships; state the watchdog now sees claude.
- `v2/docs/v1-behaviors.md` if the shared adapter's contract is recorded there.

## Prerequisites
