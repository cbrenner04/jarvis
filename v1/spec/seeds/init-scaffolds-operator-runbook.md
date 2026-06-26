---
name: init-scaffolds-operator-runbook
---

# jarvis init scaffolds an OPERATOR_RUNBOOK.md (operator knowledge as a first-class artifact)

> **Operator-designated highest priority for the next session.** The hand-built
> operator runbook is where the operator model actually lives; scaffolding it is
> the structural fix for a whole class of filed friction.

## Problem

Across operator+jarvis sessions, the single most valuable artifact is the
hand-written `operator-runbook.md` — not any one jarvis feature. Jarvis emits
good structured signals (exit codes, `no spec directory moved`, boundary
violations, agent-fallback logs), but the **interpretation and recovery recipe
live only in the operator's runbook**. The costliest moments are precisely the
ones not yet captured. Today that runbook is 100% hand-built: new project / new
operator = blank page, re-learn the same gotchas. Most filed friction (issues #529, #533, #536, #547, #566, #585, #519, #520) is really "this should have been written where the operator would see it at the right moment." Intake #598.

## Direction

`jarvis init` scaffolds an `OPERATOR_RUNBOOK.md`, seeded from what jarvis knows
and structured to accumulate what it can't know up front.

- **Seed from init-time facts:** repo path/URL/key, inferred stack, resolved
  `readyCommand`, `plan.commit` mode, `agentOrder`, `prNarrative` mode; the spec
  layout (esp. the `commit:false` external `~/.jarvis/specs/<proj>` ↔ symlink
  arrangement — a top confusion source); a repos-and-gates table; sandbox/network
  notes.
- **Stub emergent sections** (with fill-in prompts): manual-finalize/recovery
  recipes keyed by exit reason; resume-first guidance (`run` again /
  `--resume-review` / `triage --mark-ready`) vs hand-finalize; gate blind spots
  (what `readyCommand` can't verify — render-timing, fixed-position/portal
  geometry, animation); cross-repo coordination.
- **Two multipliers:** (1) link each documented gotcha/workaround to its jarvis
  issue URL so the next operator can tell when a workaround is obsolete; (2)
  consider failure exits printing `see runbook: <section>` and/or a
  `jarvis runbook add` to append a learning in place, so the runbook compounds
  instead of decaying.

## Out of scope

- The Jarvis-on-Jarvis `v1/docs/operator-runbook.md` (already exists; it is the
  mature example this generalizes from).
- Auto-writing emergent recovery recipes jarvis can't know at init (those are
  stubbed for the operator to fill).

## References

- Intake #598. Mature hand-built example available as a starting template (the
  groceries operator runbook).
- Related friction this would have front-loaded: #529, #533, #536, #547, #566,
  #585, #519, #520.
