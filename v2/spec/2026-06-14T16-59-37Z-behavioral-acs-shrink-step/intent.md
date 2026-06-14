---
name: behavioral-acs-shrink-step
---

# Behavioral ACs + post-completion shrink step

PR #203 (write loop, ~2k lines) shrank 25% (−561 lines) under one manual review
pass with zero functional change. The bloat had three sources; the injected
restraint principles already target the middle one and didn't catch the rest.
Fix the other two ends: less bloat mandated *in* by specs, and a dedicated turn
to take the rest *out*. Prompt-only fixes have repeatedly failed here — during
generation, restraint loses to the agent's actual objective (tick the
criterion, emit the token).

## 1. Spec guidance: ACs describe observable behavior, not structure

Evidence: "migrations are forward-only and idempotent (test)" produced a
72-line migration ledger guarding three already-idempotent `CREATE TABLE IF NOT
EXISTS` statements; "no duplicate outcome row" produced a 1:1 `outcomes` table.
The criteria described structures, so the structures became mandatory. This is
the plan-loop precision-amplifier failure surfacing downstream at write time.

Amend spec guidance (`v1/docs/spec-guidance.md`, and wherever v2 plan-mode
rules land): acceptance criteria state observable behavior ("re-opening an
existing store is a no-op", "recovery cannot double-advance the checkpoint")
and stay silent on schema, tables, files, and shapes — unless the structure
*is* the contract (a public API, a wire format).

## 2. Shrink step: one extra write-loop iteration after spec completion

When the spec completes (terminal `done`/`no-work` with passing artifact
contract), before ready: run one more iteration whose only instruction is a
simplification checklist over the run's diff. Structurally it is another
`executeWrite` step with different rules text and the same terminal contract.

Placement decisions (made; not to be relitigated in plan):

- **Not in the review debate.** The debate roles resolve judgment; a shrink
  pass has a mechanical verdict (tests green, ACs intact, diff smaller or
  not) — nothing to adjudicate, so the adversarial cycles buy nothing.
- **Once per spec, not per iteration/patch.** Amortized over the iterations
  that produced the code, roughly one extra invocation per ~10.
- `no-work` is a fine outcome; the cost is one short invocation.

Guardrails:

- Scope is the run's diff only — files the spec's iterations didn't touch are
  off limits.
- Tests must pass and no acceptance criterion may regress; deleting a test to
  get smaller is a contract miss.
- Hunts patterns, not line counts (no numeric targets in the prompt): fields
  derivable from other inputs, pass-through wrappers, dead enum/status values,
  1:1 tables, repeated test input literals, docs restating signatures,
  machinery with no consumer yet (the ledger).

## Documentation updates (for the eventual spec)

- `v1/docs/spec-guidance.md`: the behavioral-AC rule.
- `v2/docs/write-behavior.md`: the shrink step in the loop lifecycle.
- `v2/docs/coding-standards.md`: cross-link the shrink checklist to the
  restraint principles (same patterns, gate surface vs prevention surface).

## Refinement

- A shrink iteration that misses the contract (AC regresses / test deleted /
  tests red) is discarded, not propagated: its changes are reverted and ready
  proceeds on the pre-shrink code. Rules out treating shrink as an ordinary
  write iteration whose failed terminal contract aborts the run — an optional
  cleanup pass must never gate an already-complete, passing spec.

## Refine skip

Intent is complete: placement decisions pinned, guardrails enumerated, and the
one load-bearing edge case (shrink-miss discarded, never gates ready) captured.
Remaining choices (diff-base mechanism, quota behavior mid-shrink) are either
implementer defaults or already subsumed by the discard-on-miss rule. Nothing
load-bearing to add.
