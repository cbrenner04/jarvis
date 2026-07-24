# TUI collapses workflow to one row

One workflow invocation produces several durable list rows. The monitor shows each row separately,
so a few workflows crowd the table and obscure what is active now. This subspec lands after the
one-hour terminal window filter on the same monitor seam.

## Prerequisites

- Subspec [00 - TUI one-hour terminal window](./00-tui-one-hour-terminal-window.md) complete.
- `tui-cannot-distinguish-a-workflows-runs` merged: expanded rows show workflow role labels,
  terminal step snapshot matches outcome, and attempt counts reflect invocations.

## Decisions

- Default monitor table shows **one top-level row per workflow invocation**; expand reveals
  constituent runs with role labels; rules out leaving every durable run as a top-level row.
- Collapsed row shows workflow identity, rolled-up status, and the active step while any constituent
  run is non-terminal; after terminal rollup it shows the workflow terminal status; rules out a
  collapsed row that omits step or outcome context.
- Grouping uses `workflowSnapshot.invocationId` on existing list rows; rules out new daemon
  persistence solely for collapse.
- The twenty-row terminal cap from subspec 00 applies to **collapsed** workflow rows, not per
  constituent run; rules out counting each step run against the cap.
- Expanded-row role labels and step snapshots reuse the distinguish-workflows behavior; rules out
  shipping collapse without that labeling.
- Invocation-linked terminal siblings outside the one-hour window stay omitted per subspec 00 when
  collapsed; rules out reintroducing daemon invocation retention in the collapsed view.

## Tasks

- Add collapsed monitor row model and rendering in `tui-monitor-lines` (and ink monitor as needed).
- Wire expand/collapse selection in `tui-entry` / monitor controls without breaking steering on
  underlying run IDs.
- Apply the subspec 00 live-window filter on collapsed top-level rows (rollup finish time for
  terminal workflows).
- Add `v2/src/tui/tui-monitor-workflow-collapse.test.ts` with a multi-run workflow fixture;
  assert rendered table text per `v2/docs/test-writing.md`.
- Update `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `tui-monitor-workflow-collapse.test.ts` with a three- or four-run workflow fixture asserts
      the collapsed monitor table shows one top-level row, not one per run; it fails against
      baseline.
- [ ] The same test expands the row and asserts each constituent run shows distinct role-identifying
      labels in rendered output.
- [ ] While a constituent run is non-terminal, the collapsed row identifies the active step in
      rendered output; after terminal rollup it shows the workflow terminal status in rendered
      output.
- [ ] Coverage asserts rendered monitor text, not only view-model state.
- [ ] Tests fail when collapse is disabled or inverted: every constituent run must appear as its
      own top-level row in rendered output under inversion.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — collapsed workflow rows and expansion.
- `v2/docs/v1-behaviors.md` — TUI one row per workflow invocation by default; expand for runs.
