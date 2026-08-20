---
name: dismiss-pipeline-tui-display
---

# Dismiss Pipeline TUI Display

## Primary implementation surface

`v2/src/tui/tui-monitor-pipeline-tree.ts`

Unsplit rationale: The whole change is one cohesive TUI display-layer concern — filtering dismissed pipelines out of the pure work-tree and needs-attention projections plus a session-only show-dismissed toggle that switches the `pipeline_list` request; it reads the already-landed `dismissedAt`/`includeDismissed` surface and adds no new module boundary worth splitting across.

## Prerequisites

- A pipeline carries a nullable durable dismissal timestamp that survives reopening the state store, with dismiss/undismiss store operations that leave stage records and derived state untouched.
- The daemon accepts `pipeline_dismiss` and `pipeline_undismiss`, excludes dismissed pipelines from the default `pipeline_list` projection, and includes them with `dismissedAt` under an explicit opt-in parameter.

## Surface

TUI.

## Problem

- The TUI work tree and needs-attention segment paint every pipeline in the snapshot, including abandoned awaiting gates and old failures; last-good snapshot merging also keeps a pipeline painted after the daemon stops returning it, so daemon-side exclusion alone does not clear the display.

## Behavior

- Dismissed pipelines are absent from the TUI work tree and the needs-attention segment by default; a show-dismissed toggle requests them and renders them marked as dismissed.

## Decisions

- Filter dismissed pipelines in the pure tree and attention projections, not only at the request; rules out relying on daemon exclusion alone, which leaves stale last-good snapshots painting dismissed pipelines.
- Filtering drops a dismissed pipeline's whole subtree — stages, lanes, and attributed runs — and every attention row derived from it; rules out hiding the pipeline row while orphan stage or gate rows survive.
- The toggle switches the `pipeline_list` request to the opt-in and repaints; dismissed rows carry a distinguishing marker when shown. Rules out a toggle that only affects local filtering and silently shows nothing.
- The toggle is display-only session state, not persisted; rules out a durable operator preference this seed has no consumer for.

## Required verification

- A pure-function test over the work-tree model asserts a dismissed pipeline and its stage/lane/run descendants are absent from the default projection and present when dismissed are shown; it fails against the pre-fix model.
- A pure-function test over the attention-row model asserts a dismissed pipeline contributes no gate, failure, or publication-failure rows and does not count toward the row total or overflow.
- A TUI test asserts the show-dismissed toggle issues the opt-in `pipeline_list` request and that dismissed rows render with the dismissed marker.
- A test asserts a dismissed pipeline retained in a last-good snapshot is still excluded from the default projections.

## Documentation updates

- `v2/docs/operator-runbook.md` — the TUI show-dismissed toggle, that dismissed pipelines leave the work tree and needs-attention segment without losing their record.
- `v2/docs/v1-behaviors.md` — the TUI work tree and needs-attention segment no longer paint every pipeline in the snapshot.
