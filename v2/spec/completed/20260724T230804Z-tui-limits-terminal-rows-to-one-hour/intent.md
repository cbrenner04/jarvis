---
name: tui-limits-terminal-rows-to-one-hour
---

# TUI terminal rows follow a one-hour live window

## Problem

The monitor is the operator's live surface. It shows every non-terminal run plus the fifty newest
terminal runs the daemon list returns (`LIST_TERMINAL_RUN_LIMIT`), plus invocation-linked terminal
siblings in the list payload, so the table is count-based noise — busy hours bury recent work and
quiet days show yesterday. Narrowing the TUI without a history query would strand run IDs outside
the window.

## Decisions

- Terminal rows in the TUI are retained by **finished time within the last hour**, newest first, at
  most twenty rows; rules out mirroring the daemon fifty-newest cap as the live view policy.
- The twenty-row cap bounds **top-level terminal monitor rows** after the spec ships: twenty
  terminal runs while only this subspec is landed; once the collapse subspec lands, twenty **collapsed
  workflow rows**, not one per constituent run.
- The TUI does **not** keep terminal runs outside the one-hour window for invocation-linked
  sibling completeness; finished-time filter wins over invocation grouping.
- Non-terminal runs stay visible regardless of age; rules out time-filtering active work.
- One hour is hardcoded; rules out a configurable window in this pass.
- Default `jarvis run list` retention stays transport-bound; the TUI applies its own filter on top
  of list payloads; rules out changing the unflagged CLI default to match the TUI window.
- Plan with `tui-collapses-workflow-to-one-row` in **one spec / one PR**; this subspec is index-first,
  collapse second; rules out parallel plan off the same monitor seam.

## Acceptance criteria

- [ ] `tui-monitor-terminal-window.test.ts` (or equivalent) drives the TUI monitor with terminal
      runs inside and outside the one-hour window and asserts only in-window terminal rows render,
      in descending finish order, capped at twenty; fails against baseline.
- [ ] The same or companion test asserts a non-terminal run older than one hour still renders.
- [ ] Coverage asserts rendered monitor text, not only view-model state — see `v2/docs/test-writing.md`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — TUI one-hour terminal window; `run list --since` for older runs.
- `v2/docs/v1-behaviors.md` — TUI live terminal window vs default `run list` retention.

## Prerequisites

- `jarvis run list --since` returns terminal runs older than the daemon default list window so omitted TUI rows remain discoverable.
