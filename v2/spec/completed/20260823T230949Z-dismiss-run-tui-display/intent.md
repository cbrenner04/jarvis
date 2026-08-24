---
name: dismiss-run-tui-display
---

# Dismiss Run TUI Display

## Primary implementation surface

`v2/src/tui/tui-monitor-pipeline-tree.ts`

Unsplit rationale: The whole change is one cohesive TUI display-layer concern — filtering dismissed runs out of the pure work-tree projection and widening the existing show-dismissed toggle to request them — reading the already-landed run `dismissedAt`/`includeDismissed` surface; there is no second module boundary to split across.

## Prerequisites

- A run carries a nullable durable dismissal timestamp that survives reopening the state store, with dismiss/undismiss run store operations that leave status, attempts, and workflow snapshot untouched.
- The daemon accepts run dismiss/undismiss requests, excludes dismissed runs from the default `list` projection, and includes them with `dismissedAt` under `includeDismissed: true`.
- The TUI carries a session-only show-dismissed toggle on the `D` key that switches the `pipeline_list` request to `includeDismissed` and paints dismissed pipelines with a marker.

## Surface

TUI.

## Problem

- The TUI work tree paints every run in the snapshot, so dismissed ad-hoc top-level rows and dismissed run leaves under a pipeline stage keep cluttering the tree; last-good snapshot merging also keeps a run painted after the daemon stops returning it, so daemon-side exclusion alone does not clear the display.

## Behavior

- Dismissed runs are absent from the TUI work tree by default — both as ad-hoc top-level rows and as run leaves — and the existing show-dismissed toggle requests them and renders them with a dismissed marker, the same marker and session-only semantics dismissed pipelines already use.

## Decisions

- Widen the existing `D` toggle and its state to cover runs as well as pipelines, and keep it session-only and non-persisted; rules out a second key and rules out a durable operator preference this seed has no consumer for.
- The toggle switches the run `list` request to `includeDismissed` alongside the `pipeline_list` request it already switches, so one keystroke reveals both; rules out revealing runs while pipelines stay hidden.
- Filter dismissed runs in the pure work-tree projection, not only at the request; rules out relying on daemon exclusion alone, which leaves stale last-good snapshots painting dismissed runs.
- Filtering removes a dismissed ad-hoc node with its whole subtree and removes a dismissed run leaf from under its stage without hiding the stage; rules out dropping a stage whose only visible run is dismissed.
- Dismissed rows shown under the toggle carry the same `(dismissed)` marker dismissed pipelines use; rules out a run-specific marker vocabulary.

## Required verification

- A pure-function test over the work-tree model asserts a dismissed ad-hoc run and its descendants are absent from the default projection and present with the dismissed marker when dismissed are shown; it fails against the pre-fix model.
- A pure-function test asserts a dismissed run leaf under a pipeline stage is hidden by default while its stage row survives.
- A TUI test asserts the show-dismissed toggle issues the `includeDismissed` run `list` request as well as the pipeline one.
- A test asserts a dismissed run retained in a last-good snapshot is still excluded from the default projection.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `D` toggle now covers runs as well as pipelines, and dismissed runs leave the work tree without losing their record.
- `v2/docs/v1-behaviors.md` — the TUI work tree no longer paints every run in the snapshot.
