---
name: retire-implement-mutation-checkpoint-verification
---

# Retire implement-time mutation-checkpoint verification

Unsplit rationale: Retiring checkpoint verification is one execution-loop behavior.

## Prerequisites

- Plan drafting, review, normalization, and durable guidance no longer require, author, or validate mutation/keystone checkpoint syntax, while the named pre-fix failing-test rule remains.

## Primary implementation surface

- Execution loop

## Problem

- Implement completion still parses checkpoint-shaped criteria, applies authored directives, and spends write iterations repairing contracts that plans can no longer validate when written.

## Behavior

- Implement completion checks ordinary acceptance-criterion completion without selecting or verifying checkpoint-shaped criteria.
- The checkpoint verifier and its guard, mutation-directive, and keystone-directive reprompt prompts are deleted.
- Diff-derived mutation verification and `write.mutation-repair` remain the sole mutation gate with unchanged candidate, scoped-test, repair-budget, and failure behavior.
- Runtime smoke verification remains responsible for the shipped-no-op case formerly represented by keystones.

## Decisions

- Delete checkpoint parsing, verification, and prompt repair rather than leave dormant compatibility entry points; rules out future callers reviving the retired DSL.
- Preserve diff-derived verification and mutation repair unchanged; rules out weakening the mechanical test-gap gate while removing authored checkpoints.
- Leave durable checkpoint log variants and daemon replay inputs inert for subsequent boundary cleanup; rules out coupling execution retirement to persistence and daemon changes in one spec.

## Acceptance criteria

- [ ] Write completion tests pin that checked checkpoint-shaped criteria trigger no checkpoint selection, mutation application, or checkpoint-specific reprompt.
- [ ] Implement completion exposes no checkpoint-specific verifier or reprompt capability.
- [ ] Existing diff-derived mutation-verifier, mutation-repair, and runtime-smoke tests stay green without semantic changes.
- [ ] `bun run typecheck` and the v1, v2, and v2 integration suites pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove checkpoint completion and repair-loop contracts while retaining diff-derived verification and mutation repair as the sole mutation gate.
- `v2/docs/prompts.md` — remove the three checkpoint reprompt prompt entries and retain `write.mutation-repair`.
- `v2/docs/test-writing.md` — remove checkpoint verifier, directive, keystone, and pin-classifier guidance; retain diff-derived mutation guidance.
- `v2/docs/workflow-runner.md` — remove implement checkpoint-repair behavior and retain runtime smoke semantics.
- `v2/docs/v1-behaviors.md` — replace the implement checkpoint contract with the diff-derived-only behavior.
