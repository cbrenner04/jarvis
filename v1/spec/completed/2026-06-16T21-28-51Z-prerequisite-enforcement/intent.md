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

Let v1 plan mode refuse to draft when a consumed ready-intent's prerequisite
behaviors are not legibly present in the existing repo. No separate completion
record and no extra agent: the draft agent itself judges prerequisite presence
against repo files as its first step, and exits naming any it can't confirm.

Scope is v1 harness work: `prompts/**`, `v1/**`, and docs. This is the third of
three ordered seeds and depends on the prior behaviors:

- `jarvis1 intent` emits authored ready-intents with a `Prerequisites` section.
- `jarvis1 plan` consumes one ready-intent and carries its prerequisites as
  drafting context.

## Prerequisites

- `jarvis1 intent` exists as a split mode that emits authored ready-intents into
  `ready-intents/`, each carrying a `## Prerequisites` section.
- `jarvis1 plan` consumes a single ready-intent from `ready-intents/` and carries
  its declared prerequisites into drafting context.

## Problem

Ready-intents can declare prerequisite behaviors, but today those declarations
are only prose; nothing stops plan from drafting against a tree that lacks a
dependency.

This does not need a completion record to fix. A behavior ledger drifts the
moment code changes and nobody re-ticks it; anchoring to `v2/docs/v1-behaviors.md`
ties the mechanism to a doc that is deleted when v1 retires. The repo itself is
the only source of truth that is always current — so prerequisite presence is a
question to ask of existing files, not of a parallel record.

## Desired behavior

The plan draft agent gates itself. As its first action, before producing any
spec content, it reads existing repo files and judges whether each
`Prerequisites` behavior is legibly present.

- If every prerequisite is clearly present, it drafts the spec as normal.
- If it cannot cleanly confirm a prerequisite from existing files, plan exits
  non-zero naming the missing behavior(s) and drafts nothing.

The signal is the repo, read by the agent plan already runs. There is no
completion record, no merged-state mapping, no behavior-key namespace, and no
extra preflight agent.

Prerequisites are described as behaviors an agent can verify against repo files,
not as intent filenames, spec directories, branches, or PRs. The behavior is the
dependency contract; the artifact that delivered it is implementation detail.

## Decisions

- The signal is the repo. Prerequisite presence is judged by reading existing
  files, never a separate ledger, merged-state record, or `v1-behaviors.md`.
- One agent. The draft agent makes the call as its first step — no dedicated
  preflight agent and no draft-phase `## Blocker` appended after drafting.
- Fail closed. "Cannot cleanly confirm the behavior exists" is treated as
  absent, not present. A present-but-illegible behavior reading as absent is the
  signal it is not legible enough to depend on, not a bug.
- No special case for pre-existing behavior. Already-shipped behavior is in the
  repo, so the agent sees it; in-flight behavior is not, so it does not. Same
  path for everything; no backfill.
- True dependencies only. This must not create a fake linear work queue where
  every prior intent becomes a prerequisite.

## Acceptance signals

- `jarvis1 plan <ready-intent>` exits non-zero and drafts nothing when a
  prerequisite behavior cannot be confirmed in existing repo files; stderr names
  each unconfirmed behavior.
- A ready-intent whose prerequisite behaviors are legibly present in the repo
  proceeds into normal spec drafting and review.
- The presence judgment runs before any spec content is produced, so a failed
  gate wastes no draft or review work.
- No completion record, behavior ledger, or `v1-behaviors.md` entry is added or
  required by the mechanism.
- Tests cover satisfied prerequisites, an unconfirmable prerequisite, and
  empty/no prerequisites.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` with the draft-agent prerequisite gate, its
  fail-closed semantics, and the non-zero exit naming unconfirmed behaviors.
- Update `v1/docs/spec-guidance.md` on authoring `Prerequisites` as behaviors an
  agent can verify against existing repo files.

## Out of scope

- Any completion record, behavior ledger, or merged-state mapping.
- A dedicated preflight/checker agent separate from the draft agent.
- Cross-machine or shared completion state.
- Automatic dependency fan-out or work-queue scheduling.
- Requiring prerequisites for every intent.

## Refine decision

Load-bearing decision resolved: prerequisite presence is an agent legibility
check against existing repo files, made by the draft agent as its first step,
fail-closed — not a completion record. This reverses the raw seed's open
"mechanism is a planning decision (ledger/merged-state)" framing and its
preflight-before-drafting split; the seed text above is kept verbatim as the
original input.
