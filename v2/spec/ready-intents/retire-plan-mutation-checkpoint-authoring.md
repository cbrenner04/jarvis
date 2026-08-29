---
name: retire-plan-mutation-checkpoint-authoring
---

# Retire mutation-checkpoint authoring from plans

Unsplit rationale: Retiring checkpoint authoring is one plan-authoring-and-review behavior.

## Prerequisites

## Primary implementation surface

- Plan authoring and review

## Problem

- Plan agents must name checkpoint pins and mutations before implementation creates the tests and production text, producing hollow or stale contracts that require operator repair.

## Behavior

- Plan drafting keeps the requirement for a named test that fails before the fix and passes afterward.
- Plan drafting no longer requires guard-inversion criteria or authors mutation, keystone, or directive checkpoint syntax.
- Plan review no longer injects hollow-pin findings, and draft normalization no longer rejects keystone-shaped criteria.
- Durable guidance retires the checkpoint authoring language and forbids new hardening work while previously authored trees drain.

## Decisions

- Remove checkpoint authoring from draft, review, normalization, and guidance together; rules out leaving a plan-stage validator for syntax the draft contract no longer emits.
- Preserve the named pre-fix failing-test rule; rules out weakening behavioral regression evidence with the DSL retirement.
- Accept no new checkpoint hardening during the drain interval; rules out extending machinery already scheduled for deletion.

## Acceptance criteria

- [ ] `shared/prompts/plan-draft.test.ts` pins a rendered draft prompt that requires a named pre-fix failing test but carries no guard-inversion or checkpoint-authoring mandate.
- [ ] Plan review and draft-normalization tests pin the absence of hollow-pin injection and keystone-shape rejection.
- [ ] Plan-authored acceptance criteria receive no mutation, keystone, or directive checkpoint syntax from Jarvis prompt or guidance sources.
- [ ] `bun run typecheck` and the v1, v2, and v2 integration suites pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — remove mutation/keystone checkpoint authoring and retain named-failing-test guidance.
- `v1/docs/operator-runbook.md` — record retirement sequencing and the no-new-hardening rule.
- `v2/docs/workflow-runner.md` — remove the plan-authored keystone contract.
- `v2/docs/test-writing.md` — remove plan-time checkpoint pin-classifier and keystone-shape contracts.
- `v2/docs/v1-behaviors.md` — record the retired guard-inversion mandate, hollow-pin review injection, and keystone draft rejection.
