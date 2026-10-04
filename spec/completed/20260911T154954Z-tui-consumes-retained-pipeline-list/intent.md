---
name: tui-consumes-retained-pipeline-list
---

# Keep TUI pipeline surfaces on the retained projection

## Prerequisites

- Default `pipeline_list` returns every non-terminal pipeline plus the 50 newest terminal pipelines, while explicit `sinceMs` or derived-state queries bypass the cap and durable rows remain intact.
- `jarvis pipeline list --since <duration|timestamp>` and `--state <pipeline-state>` forward history filters to every daemon and expose matching terminal pipelines beyond the default window; `--all` remains the independent dismissal opt-in.

## Primary implementation surface

- TUI daemon polling and pipeline-derived models (`v2/src/tui/`)

## Problem

The work tree and needs-attention segment must not re-expand the daemon's retained pipeline snapshot or acquire a separate retention rule that drifts from `pipeline list`.

## Behavior

The TUI requests the default retained `pipeline_list` projection and derives the work tree, work counts, and pipeline-sourced attention only from those returned snapshots. All retained non-terminal pipelines remain visible; terminal pipelines absent from the RPC projection appear nowhere in those models.

## Decisions

- Keep retention at the daemon boundary; rules out an independent TUI age/count filter.
- Preserve the session-local dismissed toggle by sending only `includeDismissed`; it does not request unbounded history.
- Preserve stale-last-good behavior for transient RPC failure, but replace a socket's snapshot wholesale after a successful retained response so previously visible beyond-window terminals do not survive refresh.
- Leave the attention segment's independent terminal-incident recency and always-visible gate rules unchanged; retention limits its pipeline input before those rules run.

## Acceptance criteria

- [ ] A TUI client test proves normal and show-dismissed polling request `pipeline_list` without `sinceMs`, with only the expected `includeDismissed` value.
- [ ] Pure work-tree model tests select a daemon-retained subset from a fixture with more than 50 terminal pipelines and prove only the returned terminal members render while every returned old non-terminal member remains visible.
- [ ] Pure attention-model tests prove a terminal pipeline omitted by retention contributes no gate, stage-failure, or publication-failure row, while retained actionable pipelines keep existing attention behavior.
- [ ] A TUI regression test proves a successful refresh replaces a prior larger snapshot so beyond-window terminal pipeline rows, descendants, counts, and attention do not linger; it fails against the pre-fix refresh behavior.

## Documentation updates

- `v2/docs/operator-runbook.md` — TUI and CLI default views share pipeline retention; cross-link pipeline dismissal and stale-terminal attention suppression as independent display rules.
- `v2/docs/tui.md` — retained pipeline membership and interaction with the dismissed toggle and attention recency.
- `v2/docs/v1-behaviors.md` — TUI pipeline-derived surfaces inherit daemon display retention.
