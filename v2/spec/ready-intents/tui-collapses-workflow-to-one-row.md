---
name: tui-collapses-workflow-to-one-row
---

# TUI collapses each workflow invocation to one row

## Problem

One workflow invocation produces several durable run rows (write, review, shrink, …). The monitor
lists each row separately, so a handful of workflows fill the table with near-identical lines and
the operator cannot see what is happening now at a glance.

## Decisions

- Default monitor table shows **one row per workflow invocation**; expanding reveals constituent runs
  with role labels; rules out leaving every durable run as a top-level row.
- Collapsed row shows workflow identity, rolled-up status, and the active step while any constituent
  run is non-terminal; after terminal rollup it shows the workflow terminal status; rules out a
  collapsed row that omits step or outcome context.
- Presentation groups existing list rows by invocation; rules out new daemon persistence solely for
  collapse.
- Plan with `tui-limits-terminal-rows-to-one-hour` in **one spec / one PR**; index order is terminal
  window subspec first, then this subspec; rules out parallel plan off the same monitor seam.
- Expanded-row identity (role labels, step snapshot, attempts) comes from
  `tui-cannot-distinguish-a-workflows-runs`; rules out shipping collapse without that behavior.

## Acceptance criteria

- [ ] `tui-monitor-workflow-collapse.test.ts` (or equivalent) with a three- or four-run workflow
      fixture asserts the collapsed monitor table occupies one top-level row, not one per run; fails
      against baseline.
- [ ] The same test expands the row and asserts each constituent run still shows the distinct
      role-identifying labels from distinguish in rendered output.
- [ ] While a constituent run is non-terminal, the collapsed row identifies the active step; after
      terminal rollup it shows the workflow terminal status in rendered output.
- [ ] Coverage asserts rendered monitor text, not only view-model state — see `v2/docs/test-writing.md`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — collapsed workflow rows and expansion.
- `v2/docs/v1-behaviors.md` — TUI one row per workflow invocation by default; expand for runs.

## Prerequisites

- `tui-cannot-distinguish-a-workflows-runs` merged (ready-intent or implemented subspec): expanded
  rows identify workflow role, terminal step snapshot matches outcome, attempts reflect invocations.
- `tui-limits-terminal-rows-to-one-hour` subspec in the same spec merged or complete before this
  subspec runs (serial monitor seam).
