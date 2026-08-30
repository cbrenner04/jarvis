# Document implement mutation-verification lifecycle

## Problem

Operator and architecture docs still describe publication as the first diff-derived mutation discovery point for implement completion.

## Decision ledger

- Align durable docs with subspecs 00–03 in one docs-only subspec; rules out deferring operator-facing semantics to a follow-up PR.
- Subspec 04 owns intent-level harness gates (`typecheck`, `test:v2`, `test:integration:v2`); rules out index-routed completion with orphan intent checkboxes.

## Prerequisites

- Subspecs 00–03 land in-loop verification, reprompt/resume parity, and publication confirm-only behavior.

## Task checklist

- Update `v2/docs/write-behavior.md`: implement loop verifies diff-derived mutations at `done` and reprompts on a survivor; publication verification is confirm-only.
- Update `v2/docs/workflow-runner.md`: completion-verification ordering — in-loop discovery before review/publication, publication re-check after.
- Update `v2/docs/operator-runbook.md`: mutation misses reprompt the live agent rather than stranding post-publication; a publication-time survivor is a repair-introduced mutant; reconcile quiescence / mutation-verification timing with in-loop-first discovery; document direct-write pause/resume omitting reprompt replay (same gap as landing/staged-Markdown).
- Update `v2/docs/prompts.md`: document `write.surviving-mutation-reprompt` and its placeholders.
- Update `v2/docs/v1-behaviors.md`: record the changed v2 implement completion mutation-verification lifecycle.

## Acceptance criteria

- [ ] `v2/docs/write-behavior.md` documents implement in-loop diff-derived mutation verification with surviving-mutation reprompt and confirm-only publication re-check.
- [ ] `v2/docs/workflow-runner.md` documents completion-verification ordering: in-loop discovery before review/publication, publication re-check after.
- [ ] `v2/docs/operator-runbook.md` documents that implement mutation misses reprompt the live agent, publication-time survivors indicate repair-introduced mutants, and direct-write pause/resume does not replay surviving-mutation reprompt context.
- [ ] `v2/docs/prompts.md` documents `write.surviving-mutation-reprompt`.
- [ ] `v2/docs/v1-behaviors.md` records the v2 implement completion mutation-verification lifecycle change relative to publication-only discovery.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — implement in-loop verification, reprompt, and confirm-only publication re-check.
- `v2/docs/workflow-runner.md` — completion-verification ordering.
- `v2/docs/operator-runbook.md` — recovery semantics for in-loop vs publication-time survivors; direct-write reprompt gap.
- `v2/docs/prompts.md` — `write.surviving-mutation-reprompt`.
- `v2/docs/v1-behaviors.md` — v2 implement completion mutation-verification lifecycle.
