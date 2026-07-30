---
name: plan-blocks-unmet-split-dependencies
---

# Plan on a dependent split intent blocks until prerequisite surfaces land

## Problem

Surface-fanned ready-intents from one seed depend on each other in dependency order. Running
`jarvis1 plan` on a later surface while earlier surfaces are still unmerged forces the draft agent
to guess or draft against missing foundations.

## Decisions

- The existing plan prerequisite gate enforces split dependency order — rules out a parallel intent-order gate or filename-prefix contract.

## Acceptance criteria

- [ ] A regression test plans a dependent ready-intent whose prerequisites name behaviors not yet present in the repo and asserts plan exits non-zero with a blocker naming the missing behavior; it fails if plan drafts normally against the pre-fix prompt or gate.
- [ ] Inverting the prerequisite-gate pass path turns the plan-block regression test RED.

## Documentation updates

- `v2/docs/workflow-runner.md` — split fan-out declares cross-surface order through prerequisites; plan blocks on unmet prerequisites rather than guessing.

## Prerequisites

- Multi-surface seeds fan out into separate ready-intents that name each touched surface.
- The intent split prompt instructs surface fan-out and cross-surface `## Prerequisites` wiring in dependency order.
