---
name: verdict-survives-actuator-overreach
---

# Plan review verdict survives actuator overreach on protected files

When the plan-mode review **actuator** applies a verdict but also edits a file it
isn't allowed to touch (notably `intent.md`, which must stay a byte-for-byte copy
of the ready-intent), the post-actuator validation fails and the **entire review
pass is discarded** — verdict and all the *valid* subspec refinements alongside
it. The pass exits `agent-error`, nothing is committed or pushed, and the spec
keeps only its unrefined draft.

Observed 2026-06-27 (Phase 3 `daemon-host-ipc` plan): the actuator correctly
applied a strong 20-point verdict to subspecs `00`/`01`, but also added a
`## Prerequisites` block and a doc-update line to `intent.md`. Validation
rejected the whole pass on "intent.md was modified (not allowed)"; the verdict
and the good subspec edits were dropped. An operator recovered by reverting
`intent.md` and committing the rest by hand. This recurs whenever the actuator
runs on a less-instruction-adherent fallback agent (here: codex quota-exhausted,
so cursor actuated).

## Problem

A protected-file edit is treated as a fatal, all-or-nothing failure of the
review pass. The valid work (the verdict file + every allowed subspec edit) is
collateral damage. The verdict is the expensive, valuable output of the debate;
losing it to one stray edit on an immutable file is the wrong failure mode.

## Decisions

- When actuator output fails validation **only** because it touched a
  disallowed/immutable path (`intent.md`), the harness reverts just that path and
  commits the remaining allowed edits + verdict — rules out discarding the whole
  pass over a recoverable overreach.
- If validation fails for any other reason (e.g. edits outside the spec tree,
  malformed verdict), keep current fail-the-pass behavior — rules out broadening
  this into a blanket "ignore validation."
- The revert-and-commit path emits a visible notice (which file was reverted,
  which verdict items it dropped on the floor, if any) — rules out silently
  swallowing the discrepancy.
- Applies to both plan and patch review actuation where an immutable-copy file
  exists — rules out a plan-only fix that leaves patch exposed.

## Open for refine

- Whether to instead (or additionally) harden the actuator *prompt* to never
  touch `intent.md`, vs. only the post-hoc revert. Prefer the structural revert
  guard as the load-bearing fix; a prompt tweak is complementary, not a
  substitute (fallback agents won't reliably obey it).
- Whether verdict items that legitimately targeted `intent.md` (here: add
  `## Prerequisites`) should be surfaced to the operator as a follow-up rather
  than dropped.

## Documentation updates

- `v1/docs/plan-mode.md` — document the protected-file revert-and-continue
  behavior of the review actuator validation step.
- `v1/docs/operator-runbook.md` — the "Transient-killed plan" / actuator-recovery
  guidance can drop the manual `intent.md`-revert step once this ships
  (cleanup trigger).

## Prerequisites

- Plan mode runs the review debate with a separate verdict actuator that
  validates its edits before commit.
