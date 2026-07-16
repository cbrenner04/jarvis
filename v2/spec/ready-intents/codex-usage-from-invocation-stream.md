---
name: codex-usage-from-invocation-stream
---

# Record Codex Usage From Its Invocation Stream

Codex usage is reconstructed by correlating mutable session files after exit. The installed CLI supports `codex exec --json`, so each invocation can carry its own usage events.

**A codex invocation must end with a derivable cost.** `unavailable` is a last resort that fires when
every source failed, not an accepted resting state. Today it is the normal outcome: two consecutive
sessions wrote off codex spend as unrecoverable (64 rows on 2026-07-16T06-45, 5 rows on
2026-07-16T19) while the exact tokens sat on disk the whole time.

The correlation this intent originally proposed deleting **works, and is exact** — verified 2026-07-16
by hand-recovering all 5 of the session's codex invocations. Each invocation's **start time** maps 1:1
to a `~/.codex/sessions/YYYY/MM/DD/rollout-<local-start-time>-<uuid>.jsonl` filename (12:03:44,
12:15:49, 12:20:50 — five for five), and each file carries a cumulative
`total_token_usage` (`input_tokens` inclusive of `cached_input_tokens`). Priced against
`data/prices.json`, that recovered $2.06 that telemetry had recorded as null. So the live failure is
not that the data is missing — it is that the code correlates on **mtime + marker + cwd** and misses,
silently, on a path with no diagnostic.

## Decisions

- Invoke Codex with `--json` and derive usage from that invocation's JSONL stdout; rules out *relying on* session-file correlation as the primary source.
- **Keep session-file correlation as an explicitly-labelled fallback when the stream yields no usage** — record it as a distinct `cost_source` (e.g. `session_reconstructed`) plus a warning naming the source. Rules out deleting a working exact source and calling the result `unavailable`; rules out a silent fallback that reads as first-class stream usage.
- **Correlate on invocation start time, not mtime/marker/cwd.** The rollout filename is the invocation's local start time and is exact; the current mtime+marker+cwd key is what fails silently today.
- **`unavailable` requires both sources to have failed**, and names which. Rules out today's outcome, where a null cost is accepted while the tokens are on disk.
- Apply the stream contract to both v1 and shared Codex adapters; rules out v1 and v2 accounting semantics diverging by execution path.
- Preserve human-readable Codex output while parsing JSONL metadata; rules out exposing raw event envelopes as the agent response.
- Normalize Codex input tokens to disjoint fresh and cached buckets before local pricing; rules out double-charging cached input.
- Keep local price-table computation for Codex USD cost; rules out inventing agent-reported dollars the CLI stream does not supply.

## Behavior

- Add failing fixtures for usage-bearing, malformed, and usage-missing Codex JSONL output in both invocation paths.
- Populate successful Codex telemetry token buckets from the invocation stream and compute cost when a price exists.
- Re-key session correlation to invocation start time and retain it as the labelled fallback; remove only the prompt markers and cwd/mtime matching it replaces.
- Add a regression proving a stream-without-usage invocation still lands a costed row via the fallback, not `unavailable`.
- Preserve quota, model-configuration, generic-error, abort, retry, sandbox, model, and stdin behavior.

## Documentation updates

- Update `v1/docs/agents.md` and `v1/docs/run-loop.md` to replace session correlation with the Codex JSONL stream contract.
- Update `v2/docs/shared-invocation.md` with stream parsing, display output, usage, cost, and fallback semantics.
- Update `v2/docs/v1-behaviors.md` because existing v1 Codex accounting behavior changes.
- Update `v1/docs/operator-runbook.md` and `v2/docs/operator-runbook.md` to remove the temporary Codex attribution-gap guidance when verified.

## Out of scope

- Codex pricing-row maintenance.
- Cursor usage reporting.
- Backfilling the already-written-off rows (2026-07-16T06-45's 64 and earlier). Recoverable by the
  same method, but a reporting exercise, not this change.

## Prerequisites

- Successful Codex invocations without usage record explicit unavailable usage, no-usage cost, and a reason warning.
