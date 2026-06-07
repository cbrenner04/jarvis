---
name: patch-review-debate
---

# Intent: structure patch review as adversary → defense → judge

Restructure patch (implementation) review into a debate instead of N identical
critique passes. Three **read-only** reviewing roles, then a separate executing
role that writes:

1. **Adversary** (read-only) — reviews the diff hard, writes a findings artifact.
2. **Defender** (read-only) — reads findings, writes a rebuttal artifact.
3. **Judge** (read-only) — reads both, reconciles, emits a **verdict**: which
   findings hold and what to change. A spec increment, not a diff.
4. **Fixer** (writes) — the *only* writer. Consumes the verdict and applies it.
   This is the existing patch loop fed the verdict as its task.

## Why judge ≠ fixer

- **No self-vindication.** A judge that writes its own fix grades its own
  homework — nothing reviews the fix. Splitting them lets the fixer's diff
  re-enter the debate (recursion for free).
- **Role/model split.** Judge is *reviewing*-class work; fixer is *executing*-
  class. One role forces one model to do both — the conflation
  [[separate-models-from-agents]] exists to avoid.
- **No hand-edits.** Review never mutates the tree; it emits work and the
  executor applies it. Same rule the repo already follows: specs run through
  jarvis, not implemented by hand — applied recursively.

## Shape

- Rides on the unified review runner (PR #193). Debate roles are read-only passes
  via the existing `adapterForPass` seam; each injects the prior role's artifact
  as prompt context. No new engine.
- All three debate roles are read-only — the write boundary collapses to the
  fixer alone.
- Commit each role for a durable debate trail (`review: adversary` /
  `review: defense` / `review: judge` / `review: fixer`); empty verdict → no
  fixer run, no commit (existing no-change skip).
- Patch only to start; plan review keeps its current N-pass shape.

## Philosophy (locked)

Less is more — trust the agents.

- **No materiality gate, no convergence/stop-on-empty logic.** If there's
  nothing to find, the roles say so, the verdict is empty, and no fixer runs.
  The harness does not adjudicate whether a finding is "real" — that's the
  judge's job, in-band. (See [[plan-refine-precision-amplifier]] — the fix for
  manufactured findings is prompt permission to find nothing, not control flow.)
- Cycle count is just the existing review pass setting. No special bounds beyond
  that.

## Open

- Distinct agents per role vs. one agent in different role-prompts (genuine
  adversarialism vs. quota/fallback cost). At minimum the fixer should differ in
  *model class* (executing) from the reviewing roles.
- Commit the debate artifacts vs. keep ephemeral like the blocker sentinel.
- How the verdict is shaped so the existing patch loop can consume it as a task.

## Out of scope

- Plan review changes.
- Any convergence/materiality detection in the harness.
