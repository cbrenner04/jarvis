---
name: render-observer-verification-keeps-a-fixed-deadline
---

# Render-observer verification derives its budget from the unmutated baseline

Unsplit rationale: the budget and the `render-observer-timeout` settlement classification both live in the diff-derived mutation verifier; one surface.

## Primary implementation surface

- `v2/src/execution/diff-derived-mutation-verifier.ts`

## Prerequisites

## Problem

`verifyPromptRenderCoverage` calls `runScopedTests` with no options (clean and mutated runs), so both fall back to `MAX_KILLING_TEST_MS` (30s) instead of #3650's baseline-derived budget. A registered prompt whose observer test exceeds 30s unmutated (e.g. `write-loop.test.ts`, 35.67s) deterministically settles `render-observer-timeout` → `non_terminating_mutation_failed`, `nextAction: "resume"`; resume replays the same bound, a fixed point on complete green work (pipeline `a1b97b7d`, 2026-09-13).

## Decisions

- Render-observer clean and mutated runs use the killing-test path's baseline-derived budget mechanism; no second timing policy.
- A clean run exceeding the ceiling settles the candidate inconclusive and allows publication, matching the killing-test path.
- `render-observer-timeout` is a timing outcome, not a non-terminating mutation; it must not settle `non_terminating_mutation_failed` / `nextAction: "resume"`.
- Out of scope: observer map, `MAX_PROMPT_RENDER_VERIFICATIONS`, killing-test resolution.

## Acceptance criteria

- [ ] A `diff-derived-mutation-verifier.test.ts` regression drives a changed registered prompt whose mapped observer runs longer than `MAX_KILLING_TEST_MS` unmutated and proves verification does not settle `render-observer-timeout`; fails against the current no-options call.
- [ ] A regression asserts the `timeoutMs` passed to `runScopedTests` on both the render-observer clean and mutated calls is baseline-derived.
- [ ] A regression proves an observer whose clean run exceeds the ceiling settles inconclusive and allows publication.
- [ ] A regression proves a genuinely non-terminating observer is still reported and is distinguishable from the timing outcome by its settlement.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — Diff-derived mutation verification: render-observer budget is baseline-derived; slow observer settles inconclusive.
- `v2/docs/operator-runbook.md` — Gate trust: `render-observer-timeout` is a timing outcome; resume cannot clear the pre-fix shape.
