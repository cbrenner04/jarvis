# The TUI shows fifty terminal rows instead of what is happening now

## Problem

The TUI is the operator's live surface — `run list` is not used for watching work — and it is
mostly noise. It renders every row the daemon returns: all non-terminal runs plus the 50 newest
terminal ones (`LIST_TERMINAL_RUN_LIMIT`, `v2/src/daemon/daemon.ts:90`), plus any terminal run
sharing an invocation with one already kept, so the effective count exceeds 50.

Two compounding causes:

1. **Retention is count-based, not time-based.** Fifty is whatever fifty happens to be: a busy hour
   buries the last five minutes, a quiet day shows work from yesterday. Neither answers "what is
   happening now."
2. **A workflow is not one row.** One implement workflow produced **three to four durable run rows**
   throughout 2026-07-21 (write, review, shrink/publication). So 50 terminal rows is only ~12–15
   workflows — rendered as 50+ near-identical lines. The rows are also indistinguishable from each
   other (seed `tui-cannot-distinguish-a-workflows-runs`), so the multiplier is pure noise.

## Prerequisite

`run-list-cannot-find-an-older-run` must land first. Narrowing the window without a history query
would make older runs *harder* to reach than today: a run outside the window has no discoverable ID,
so its log and outcome become unreachable. Discovery first, then narrow.

Sequencing agreed with the operator: `key-the-daemon-by-executable-digest` →
`run-list-cannot-find-an-older-run` → this.

## Decisions

- Retain terminal runs in the TUI by **time, not count**: a one-hour window, operator-chosen.
  Rules out the fixed 50-row cap as the live view's policy.
- Live (non-terminal) runs are always shown regardless of age; a long-running run never falls out of
  view.
- **Collapse each workflow to one row by default**, expandable to its constituent runs. This removes
  the 3–4× multiplier and is the same change as `tui-cannot-distinguish-a-workflows-runs` — collapse
  turns indistinguishable sibling rows into one row with a role breakdown beneath it. Land them
  together.
- The collapsed row shows the workflow's identity, its rolled-up status, and which step is active;
  expanding shows the runs with their roles. Pin the exact rendering in the plan.
- The daemon's `LIST_TERMINAL_RUN_LIMIT` may remain as a transport bound for `run list`'s default
  view; the TUI's window is a separate policy and must not be capped by it.
- Rules out making the window configurable in this pass — one hour, hardcoded, revisit if it chafes.

## Acceptance criteria

- [ ] The TUI shows terminal runs from the last hour and omits older ones.
- [ ] Non-terminal runs are always shown, however old.
- [ ] Each workflow renders as one row by default; expanding reveals its constituent runs with
      roles.
- [ ] A workflow with three or four runs occupies one row, not three or four.
- [ ] The collapsed row identifies the active step while the workflow is live and its rolled-up
      terminal status afterward.
- [ ] Coverage asserts rendered output, not just view-model state — see
      `v2/docs/test-writing.md` on TUI tests bypassing the render path.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the TUI live window and workflow collapse; `run list`
  for anything older.
