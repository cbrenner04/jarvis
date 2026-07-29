name: terminal-window-renders-finishless-rows

# The live window renders terminal rows with no finish time

## Problem

`terminalRunInLiveWindow(undefined, …)` returns false
(`tui-monitor-terminal-window.ts:23-27`), dropping killed, interrupted, and
spawn-failed rows outright — precisely the rows an operator opens the TUI to
find. Production policy is expressed through a test flag
(`if (finishedAtMs === undefined) return invertTerminalWindowFilterForTest`), and
`setInvertTerminalWindowFilterForTest` / `setInvertTerminalRowCapFilterForTest`
(`:12-21`) are mutable globals in shipped code.

## Decisions

- A terminal row with no `finishedAtMs` is treated as in-window and rendered,
  not dropped; rules out the fail-closed policy that hides killed, interrupted,
  and spawn-failed runs. The in-window fallback is the guard only for rows that
  genuinely have no finish time.
- Delete both `setInvert*ForTest` exports; the window and cap criteria are proven
  by mutating the guard itself, not a flag. Rules out keeping the flags because
  the criteria are literally satisfiable by toggling them.
- `blocked` ages out of the window after an hour; document where to find aged-out
  blocked rows rather than special-casing them here.

## Prerequisites

- Reconciliation records a real finish timestamp on killed/interrupted runs.
- The list row's `finishedAtMs` reads the store's reconciled finish time for terminal rows the attempt path never stamped.
