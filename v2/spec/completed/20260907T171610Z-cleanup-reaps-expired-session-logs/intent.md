---
name: cleanup-reaps-expired-session-logs
---

# Cleanup reaps expired terminal session logs

## Prerequisites

## Module-boundary surface

- Cleanup session-log retention and machine-config parsing in `v2/src/commands/cleanup.ts` and `v2/src/config/machine-config-loader.ts`.

## Problem

Cleanup never reaps settled session logs, so terminal-run logs accumulate indefinitely under `~/.jarvis/sessions/`.

## Behavior

- Cleanup reaps a direct `.log` child of `~/.jarvis/sessions/` only when its owning run is terminal and its durable finish time is older than the retention window; recent, live, non-terminal, and unprovable logs remain.
- Machine config key `cleanup.sessionLogRetentionDays` accepts a positive whole number of days and defaults to 14 when absent; an invalid value makes cleanup refuse session-log reaping and reports the invalid key without deleting logs.
- `--dry-run` summarizes expired session-log count, reclaimable bytes, and oldest-kept date without listing every log; apply reports the reclaimed summary.

## Decision ledger

- Session-log expiry uses the owning run's durable terminal finish time, never file mtime; rules out deleting a live run's old-looking log.
- Unknown or non-terminal log ownership preserves the file; rules out age-only deletion when settlement cannot be proved.
- Session retention may touch only `.log` files directly under `~/.jarvis/sessions/`; rules out reaching `telemetry.jsonl`, `state/v2.sqlite`, nested research inputs, or unrelated Jarvis-home files.
- Default retention is 14 days; `cleanup.sessionLogRetentionDays` is a positive integer override, while absent uses the default and invalid refuses this reaping pass; rules out an unbounded or silently coerced policy.
- Dry-run reports aggregate log count and bytes plus the oldest-kept date; rules out flooding stdout with hundreds of thousands of filenames.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `session retention reaps only old terminal run logs` proves the default and configured windows remove old terminal-owned logs while preserving recent, live, non-terminal, and unknown-owner logs; it fails against the pre-fix no-reap behavior.
- [ ] A session-retention regression fixture proves an absent `cleanup.sessionLogRetentionDays` uses 14 days and each invalid value reports the key and preserves candidate logs; it fails against the pre-fix missing-validation behavior.
- [ ] A session-retention guard fixture proves cleanup touches only direct `.log` children of `~/.jarvis/sessions/` and preserves `telemetry.jsonl`, `state/v2.sqlite`, and files outside that directory.
- [ ] `--dry-run` reports expired session-log count, bytes, and oldest-kept date without filenames and performs no mutation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — session-log retention, invalid-setting refusal, exclusions, and summaries.
- `v2/docs/install-and-config.md` — `cleanup.sessionLogRetentionDays`, positive-integer validation, and 14-day default.
- `v2/docs/v1-behaviors.md` — record v2 session-log retention and v1 divergence.

## Primary implementation surface

v2/src/commands/cleanup.ts
