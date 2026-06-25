---
name: run-blocks-manual-visual-criteria-no-pr
---

# run: human-only acceptance criteria block (exit 7) with no PR instead of opening a reviewable draft

## Problem

A `run` whose acceptance criteria are **human-only (manual/visual)** blocks with no
PR. On a CSS/layout spec, the agent implemented the fix, committed it, and passed
the automated gate (unit tests green) — but then tried to **start the dev server to
visually confirm** the change, hit a sandbox bind error
(`listen EPERM: operation not permitted ::1:3000`), and exited `blocked (exit 7)` at
iteration 0 with **no PR opened** (branch left at a local
`WIP: ... (blocked, 4/7 criteria)` commit). The unticked criteria were exactly the
ones the spec marked visual-only (e.g. *"verified by visual inspection only"*,
*"no automated guard"*).

The operator's objective for UX/visual work is **a reviewable PR a human then
verifies**. Blocking instead of opening the PR means every visual/layout spec needs
hand-finalizing, and the agent burns a turn attempting a dev-server launch that
can't work in the sandbox.

Observed on `groceries-client` (`commit:false`), intake issue #536.

## Direction

- Recognize human-only criteria (`(Manual)` / "visual inspection only" / "no
  automated guard") as **operator-verified**: implement, pass the automated gate,
  and **open the draft PR**, leaving those criteria unchecked with a note for the
  human reviewer — rather than attempting verification it can't do and exiting
  `blocked`.
- The agent shouldn't attempt to bind a dev-server port inside the sandbox; if
  visual verification is genuinely required, surface it as a PR checklist item, not
  a hard block that suppresses the PR.

## Out of scope

- Specs whose *automated* criteria are unmet still block as today — this is only
  about criteria the spec itself flags as human-only.

## References

- Intake issue #536.
