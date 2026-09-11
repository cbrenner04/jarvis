---
name: state-store-bulk-run-dismissal
---

# State store dismisses a terminal run selection in one call

The store can only dismiss one run id at a time, so a project-wide shed is N calls. Add a store-level bulk dismissal that selects runs by the same dimension filters `run list` exposes (at minimum project), restricts the selection to terminal (`not-live`) rows, includes step rows belonging to matched workflow-entry rows, and reports how many rows it dismissed. Live rows are never dismissed by a bulk selection. Semantics stay display-only: rows are retained, first-dismissal timestamps are preserved on repeat, and `undismissRun` still reverses it.

## Prerequisites

- Runs carry a per-row `dismissedAt` display flag that `undismiss` clears.
- Runs are attributable to a project and to a parent workflow-entry run.
- Run status distinguishes terminal from live.

## Acceptance criteria

- [ ] A store test proves a bulk dismissal by project dismisses every terminal run of that project, leaves live runs undismissed, and returns the dismissed-row count; it fails against the current single-id-only store API.
- [ ] A store test proves step rows under a matched workflow-entry row are dismissed by the same call.
- [ ] A store test proves re-running the same bulk dismissal preserves the original `dismissedAt` values and reports zero newly dismissed rows.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that run dismissal now has a bulk, terminal-only selection form.
