---
name: behavioral-acs-shrink-step
---

**Scope.** This intent lives under `v2/spec/` for plan-mode routing only.
**Implementation is v1 harness work** — changes land in `shared/**`, `v1/**`,
`prompts/**`, and `v1/docs/**`. It does not target the v2 write loop or
`v2/src/**`.

# Behavioral ACs + post-completion shrink step

A recent large `jarvis1 run` implementation (~2k lines) shrank 25% (−561 lines)
under one manual review pass with zero functional change. The bloat had three
sources; prompt-layer restraint (`global.terse`, `patch.rules`) already targets
the middle one and didn't catch the rest. Fix the other two ends: less bloat
mandated *in* by specs, and a dedicated turn to take the rest *out*.
Prompt-only fixes have repeatedly failed here — during generation, restraint
loses to the agent's actual objective (tick the criterion, emit the token).

## 1. Spec guidance: ACs describe observable behavior, not structure

Evidence: criteria like "quota classification lives in a dedicated module
(test)" produced a pass-through wrapper around existing stderr heuristics;
"must open a session log file per iteration" produced parallel logging plumbing
when the harness already owned session sinks. The criteria described structures,
so the structures became mandatory. This is the plan-loop precision-amplifier
failure surfacing downstream at patch-run time.

Amend spec guidance (`v1/docs/spec-guidance.md`) and plan-mode authoring prompts
(`prompts/plan/*.md` as needed): acceptance criteria state observable behavior
("quota exhaustion falls through to the next configured agent", "a failed ready
gate leaves the PR draft") and stay silent on schema, tables, files, and shapes
— unless the structure *is* the contract (a public API, a wire format).

## 2. Shrink step: one extra patch-run iteration after spec completion

When implementation is complete (zero unchecked boxes, clean worktree, green
`bun run ready` baseline), before review / `maybeMarkReady`: run one more
patch-mode agent invocation whose only instruction is a simplification checklist
over the run's diff. Structurally it is another `jarvis1 run` iteration with
different prompt rules and the same completion contract (tests green, acceptance
criteria intact).

Placement decisions (made; not to be relitigated in plan):

- **Not in the review debate.** The debate roles resolve judgment; a shrink
  pass has a mechanical verdict (tests green, ACs intact, diff smaller or
  not) — nothing to adjudicate, so the adversarial cycles buy nothing.
- **Once per spec, not per iteration/patch.** Amortized over the iterations
  that produced the code, roughly one extra invocation per ~10.
- A no-op shrink pass is a fine outcome; the cost is one short invocation.

Guardrails:

- Scope is the run's diff only — files the spec's iterations didn't touch are
  off limits.
- Tests must pass and no acceptance criterion may regress; deleting a test to
  get smaller is a contract miss.
- Hunts patterns, not line counts (no numeric targets in the prompt): fields
  derivable from other inputs, pass-through wrappers, dead enum/status values,
  1:1 tables, repeated test input literals, docs restating signatures,
  machinery with no consumer yet (bookkeeping layers ahead of real callers).

## Documentation updates (for the eventual spec)

- `v1/docs/spec-guidance.md`: the behavioral-AC rule.
- `v1/docs/run-loop.md`: the shrink step in the patch lifecycle.
- `v1/docs/prompt-governance.md`: cross-link the shrink checklist to
  `global.terse` / `patch.rules` (same patterns, gate surface vs prevention
  surface).

## Refinement

- A shrink iteration that misses the contract (AC regresses / test deleted /
  tests red) is discarded, not propagated: its changes are reverted and ready
  proceeds on the pre-shrink code. Rules out treating shrink as an ordinary
  patch-run iteration whose failed completion contract aborts the run — an
  optional cleanup pass must never gate an already-complete, passing spec.

## Refine skip

Intent is complete: placement decisions pinned, guardrails enumerated, and the
one load-bearing edge case (shrink-miss discarded, never gates ready) captured.
Remaining choices (diff-base mechanism, quota behavior mid-shrink) are either
implementer defaults or already subsumed by the discard-on-miss rule. Nothing
load-bearing to add.

