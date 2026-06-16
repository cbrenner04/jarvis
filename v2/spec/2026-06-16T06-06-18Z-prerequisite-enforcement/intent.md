---
name: prerequisite-enforcement
---

## Raw seed

<details>
<summary>Raw seed</summary>

<<<RAW_SEED_BEGIN>>>
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

<<<RAW_SEED_END>>>

</details>

## Intent

# Prerequisite enforcement

## Summary

Enforce ready-intent behavior prerequisites before v1 plan mode drafts a spec.
Plan should be able to answer whether each prerequisite behavior has already
shipped, then stop with a clear error when a consumed ready-intent depends on
behavior that is not complete.

Scope is v1 harness work: `prompts/**`, `v1/**`, and docs. This is the third of
three ordered seeds and depends on the prior behaviors:

- `jarvis1 intent` emits authored ready-intents with a `Prerequisites` section.
- `jarvis1 plan` consumes one ready-intent and carries its prerequisites as
  drafting context.

## Problem

Ready-intents can declare prerequisite behaviors, but today those declarations
are only prose. Plan mode cannot refuse an intent whose prerequisites are not
present because no target-state source answers "is behavior X complete?"

Merged specs and completed implementation work do not currently announce which
behaviors shipped. Without a queryable completion signal, prerequisite sections
remain operator-honored ordering notes instead of an enforceable guard.

## Desired behavior

Two capabilities land together:

1. **Completion signal.** Add a minimal way to record and query that a behavior
   has shipped. The mechanism is a planning decision: a behavior ledger,
   merged-state mapping, or similar is fine if plan mode can reliably ask
   whether a behavior is complete.
2. **Enforcement.** When `jarvis1 plan <ready-intent>` consumes an intent, it
   checks the intent's `Prerequisites` behaviors before drafting. If any are not
   complete, plan exits with an error that names the missing behavior(s) and
   does not draft a spec.

Prerequisites are keyed on behavior, not intent filename, intent name, spec
directory, branch, or PR. The behavior is the dependency contract; the artifact
that delivered it is implementation detail.

## Decisions

- Keep the completion signal minimal and local to the single-operator workflow.
  It only needs to support v1 plan's prerequisite check.
- Enforce true dependencies only. This should not create a fake linear work
  queue where every prior intent becomes a prerequisite.
- Missing prerequisites are a plan preflight failure, not a draft-phase blocker
  appended by an agent.
- The check should run before agent drafting so an unavailable dependency does
  not waste plan/review cycles or produce a spec against the wrong tree.

## Acceptance signals

- A completed behavior can be recorded in a durable, documented place outside
  the active spec tree.
- Plan mode can query that completion signal by behavior key.
- `jarvis1 plan <ready-intent>` exits non-zero before drafting when the
  ready-intent names incomplete prerequisite behaviors, and stderr names each
  missing behavior.
- A ready-intent with all prerequisite behaviors complete proceeds into normal
  spec drafting and review.
- Tests cover satisfied prerequisites, missing prerequisites, empty/no
  prerequisites, and behavior-key matching that is independent of intent/spec
  filenames.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` with prerequisite enforcement timing and the
  missing-prerequisite error path.
- Document how completed behaviors are recorded and queried wherever the
  completion signal lives.
- Update `v2/docs/v1-behaviors.md` with the shipped enforcement behavior.
- Update `v1/docs/spec-guidance.md` if ready-intent prerequisite authoring or
  behavior-key conventions need durable guidance.

## Out of scope

- Cross-machine or shared completion state.
- Automatic dependency fan-out or work-queue scheduling.
- Requiring prerequisites for every intent.
- Reworking patch-mode implementation flow beyond emitting or recording the
  completion signal needed by enforcement.

## Refine skip

No net-new load-bearing decision found; existing intent already captures the enforceable contract and leaves mechanism choice to the spec.
