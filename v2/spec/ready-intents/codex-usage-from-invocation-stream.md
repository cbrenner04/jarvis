---
name: codex-usage-from-invocation-stream
---

# Record Codex Usage From Its Invocation Stream

Codex usage is reconstructed by correlating mutable session files after exit. The installed CLI supports `codex exec --json`, so each invocation can carry its own usage events.

## Decisions

- Invoke Codex with `--json` and derive usage from that invocation's JSONL stdout; rules out session-file mtime, marker, and cwd correlation.
- Apply the stream contract to both v1 and shared Codex adapters; rules out v1 and v2 accounting semantics diverging by execution path.
- Preserve human-readable Codex output while parsing JSONL metadata; rules out exposing raw event envelopes as the agent response.
- Normalize Codex input tokens to disjoint fresh and cached buckets before local pricing; rules out double-charging cached input.
- When no valid usage event exists, retain the explicit unavailable/no-usage diagnostic contract; rules out falling back to session scraping or silent nulls.
- Keep local price-table computation for Codex USD cost; rules out inventing agent-reported dollars the CLI stream does not supply.

## Behavior

- Add failing fixtures for usage-bearing, malformed, and usage-missing Codex JSONL output in both invocation paths.
- Populate successful Codex telemetry token buckets from the invocation stream and compute cost when a price exists.
- Remove prompt markers, session snapshots, and post-exit session correlation from Codex invocation paths.
- Preserve quota, model-configuration, generic-error, abort, retry, sandbox, model, and stdin behavior.

## Documentation updates

- Update `v1/docs/agents.md` and `v1/docs/run-loop.md` to replace session correlation with the Codex JSONL stream contract.
- Update `v2/docs/shared-invocation.md` with stream parsing, display output, usage, cost, and fallback semantics.
- Update `v2/docs/v1-behaviors.md` because existing v1 Codex accounting behavior changes.
- Update `v1/docs/operator-runbook.md` and `v2/docs/operator-runbook.md` to remove the temporary Codex attribution-gap guidance when verified.

## Out of scope

- Codex pricing-row maintenance.
- Cursor usage reporting.

## Prerequisites

- Successful Codex invocations without usage record explicit unavailable usage, no-usage cost, and a reason warning.
