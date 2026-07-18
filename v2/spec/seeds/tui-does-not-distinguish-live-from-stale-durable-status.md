---
name: tui-does-not-distinguish-live-from-stale-durable-status
---

# The TUI does not make live vs not-live obvious, so stale durable rows read as running work

## Problem

`jarvis tui` (and `jarvis run list`) show a run's durable `status` (e.g. `in-progress`) alongside
`isLive`, but the distinction is not visually obvious. A run can be `in-progress` + **not-live** — a
stale durable row whose agent process is gone. This happens routinely: when the operator
hand-finalizes an implement PR (biome-fix + admin-merge) instead of letting the workflow reach its
own completion, the durable row is never flipped to `completed` and stays `in-progress` forever
(until a daemon-restart reconciliation). Observed 2026-07-17: three already-**merged** specs
(lint-md, derive-slice, triage-drills) showed as `in-progress` in the TUI with zero live processes;
the operator reasonably read it as "three implementations still running."

## Decisions

- The TUI must make live vs not-live visually unmistakable (distinct column/color/glyph, or a
  `live`/`stale` label), not just an `isLive` field a reader has to cross-reference; rules out a
  durable-status display that hides whether anything is actually executing.
- A durable non-terminal row with no live process and no reachable owner should surface as `stale`
  (or similar), distinct from an actively-running row; rules out identical rendering for the two.

## Out of scope

- Auto-reconciling stale rows to terminal outside daemon restart (separate concern).

## Documentation updates

- `v2/docs/operator-runbook.md` — note the live/stale distinction in the TUI once it is obvious;
  remove the current "in-progress + not-live is normal while a run finalizes" caveat's ambiguity.
