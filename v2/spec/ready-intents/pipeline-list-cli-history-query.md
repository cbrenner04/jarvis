---
name: pipeline-list-cli-history-query
---

# Query pipeline history beyond display retention

## Prerequisites

- Default `pipeline_list` returns every non-terminal pipeline plus the 50 newest terminal pipelines, while explicit `sinceMs` or derived-state queries bypass the terminal cap without deleting durable rows.

## Primary implementation surface

- Pipeline CLI admission and multi-daemon query (`v2/src/commands/pipeline.ts`)

## Problem

The existing `jarvis pipeline list --since` filters only the already-returned RPC snapshot, so once daemon retention lands it cannot recover terminal pipelines beyond the default window.

## Behavior

`jarvis pipeline list --since <duration|timestamp>` and `--state <pipeline-state>` send their filters to every `pipeline_list` RPC and return matching durable pipelines beyond the default terminal window. Plain human and JSON listings use the retained default projection.

## Decisions

- Reuse the existing positive duration and `Date.parse` timestamp grammar; parse once in the CLI and send epoch milliseconds to each daemon.
- Keep `--all` as the dismissal opt-in: it composes with `--since` but does not itself bypass terminal retention, matching `run list --all`.
- Preserve multi-daemon merge, deduplication, newest-first output, human row shape, and the existing `--json` incompatibility with `--since`/`--state`.
- Forward `--state` as an exact derived-state filter that bypasses the default cap and composes with `--since`, preserving its current whole-history result set.
- Returned full IDs remain valid inputs to owner-routed pipeline control and observation commands.

## Acceptance criteria

- [ ] A CLI regression test proves `--since` sends the same numeric `sinceMs` to every discovered daemon and returns a terminal pipeline older than the default 50-terminal window; it fails against the pre-fix client-side-only filter.
- [ ] `--state` sends the exact derived state to every daemon, reaches matching terminal rows beyond the default cap, and composes conjunctively with `--since`.
- [ ] Duration and timestamp cutoffs remain inclusive, invalid values fail before daemon contact, and merged results remain newest-first.
- [ ] Plain list and `--json` requests omit `sinceMs` and therefore retain the daemon's default projection.
- [ ] `--all --since` sends both `includeDismissed: true` and `sinceMs`; bare `--all` includes dismissed rows without becoming a history query.
- [ ] A beyond-window ID returned by `--since` remains usable by an owner-routed pipeline observation command.

## Documentation updates

- `v2/docs/operator-runbook.md` — default retained list versus explicit history filters, examples, and `--all` dismissal composition.
- `v2/docs/write-behavior.md` — pipeline-list RPC mapping and retained/history output semantics.
- `v2/docs/v1-behaviors.md` — pipeline CLI history now reaches terminal rows outside the default display window.
