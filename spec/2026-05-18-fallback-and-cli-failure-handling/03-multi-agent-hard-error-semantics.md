# 03 — Multi-agent hard-error semantics (plan vs patch)

## Problem

On **`kind: "error"`** that is **not** upgraded to quota (strict mode, weak signal mismatch, or guard failed):

- **Patch:** that iteration **returns** with a hard failure (typically exit **3**) — next agent is only tried after **quota-style** rotation on a later iteration setup (operator re-runs jarvis).
- **Plan:** inner loops over **`modes.plan.agentOrder`** typically **continue** to the next agent on plain **error**, which can mask persistent CLI misconfiguration or repeated failures across agents.

This asymmetry may be intentional (plan optimizes availability) or accidental.

## Decisions

**Recorded choice:** policy **1 — status quo** (plan keeps trying agents on hard `error` after classification; patch stops the iteration on hard `error`). Documented in `docs/plan-mode.md` and the outcome matrix in `docs/quota-signals.md`.

Pick **one** documented policy:

1. **Status quo:** plan keeps trying agents on hard error; patch stops — document clearly in outcome matrix (subspec 00).
2. **Parity:** plan stops after first hard **error** (after guards), matching patch’s “no silent agent carousel,” possibly with a stderr hint to fix CLI/auth.
3. **Hybrid:** stop only for **`model_config`**-like failures (already fatal) but still rotate on generic errors — only if justified.

Default recommendation in this subspec’s tasks: **document status quo** unless product owner chooses parity; if parity, implement with tests for interview/draft/review/name-only loops.

## Task checklist

- [ ] Record the chosen policy in `docs/plan-mode.md` and the outcome matrix.
- [ ] If behavior changes: adjust plan loops, update tests (including fake-agent scenarios).
- [ ] If status quo: add explicit “difference from patch” paragraph to avoid future confusion.

## Acceptance criteria

- [x] Documented policy matches implementation.
- [x] Tests cover the chosen behavior for at least **one** plan phase (interview or draft) with a fake/synthetic agent double.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `docs/plan-mode.md` (stop vs continue semantics).
- [ ] `docs/quota-signals.md` or outcome matrix (cross-mode comparison row).
