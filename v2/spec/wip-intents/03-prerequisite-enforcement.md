# Prerequisite enforcement

**Scope.** v1 harness work — `prompts/**`, `v1/**`, docs. Lives in
`v2/spec/wip-intents/` for routing.

**Ordering.** Third of three (01 → 02 → 03). Depends on seeds 01 (intents carry
a declared `Prerequisites` section) and 02 (`plan` consumes ready-intents).

## Problem

Seed 01 lets an intent declare prerequisite behaviors; nothing enforces them.
`plan` can't refuse an intent whose prerequisites aren't met because nothing can
answer *"is behavior X complete?"* — a merged spec doesn't announce which
behaviors it shipped, and there's no ledger to query. This is the "ability we
don't have yet." Until it exists, prerequisites are operator-honored prose.

## Desired behavior

Two parts:

1. **Completion signal.** A way to record and query that a behavior has shipped
   — so "is behavior X complete?" has an answer. (Mechanism is a planning
   decision: a behavior ledger, a merged-state mapping, or similar. Keep it the
   minimum that lets `plan` ask the question.)
2. **Enforcement.** `plan` errors when a consumed ready-intent's prerequisite
   behaviors are not yet complete, naming the missing behavior(s) — rather than
   drafting a spec against a tree that lacks its dependency.

Prerequisites are keyed on *behavior*, not intent name: the intent that
delivered a behavior is an implementation detail of the dependency; the behavior
is the contract.

## Decisions

- True dependencies only — enforcement must not degenerate into a fake linear
  chain. A prerequisite is declared only when the intent genuinely needs the
  behavior already present.

## Documentation updates

- `v1/docs/plan-mode.md`: prerequisite enforcement and the error path.
- Wherever the completion signal lives: how a behavior is recorded complete.
- `v2/docs/v1-behaviors.md`: the enforcement behavior.

## Out of scope

- Cross-machine / shared completion state. Single operator.
- Auto-fan-out of dependencies; the operator still authors the split.
