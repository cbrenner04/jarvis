---
name: killing-test-budget-is-shorter-than-the-test-it-runs
---

# A killing test slower than 30s is reported as a non-terminating mutant, permanently

## Problem

`MAX_KILLING_TEST_MS = 30_000` (`v2/src/execution/diff-derived-mutation-verifier.ts:119`) bounds each scoped killing-test run. When that bound fires, verification settles `non_terminating_mutation_failed` — a diagnosis that the *mutant* does not terminate.

The bound cannot distinguish a non-terminating mutant from **a killing test that is simply slower than 30 seconds**. Any production file whose resolved killing test exceeds the budget is therefore unverifiable: every candidate in it is reported non-terminating, and because the misclassification is deterministic, `jarvis run resume` re-runs the same test, exceeds the same budget, and settles identically. The lane is stranded with correct, complete work.

## Evidence (2026-09-08, run `34b26330`)

The `persist-review-step-gate-commands` lane settled `non_terminating_mutation_failed` with `operator-flip: !== → ===` at `workflow-runner-resume.ts:426` — a pure boolean helper (`step?.fixCommand !== undefined || step?.readyCommand !== undefined`) with no loop in it.

Measured by hand on an idle machine, in that lane's own worktree:

| run | result | wall |
| --- | --- | --- |
| `workflow-runner-resume.test.ts`, unmutated | 61 pass / 0 fail | **32.06s** |
| same file, with the reported mutation applied | 59 pass / **2 fail** | 30.67s |

The mutant **is** killed — one of the failures is `review row gate-command reconstruction prefers persisted snapshot step over write sibling`, exactly the behaviour the mutation breaks. The verifier never observes it, because the file's clean runtime already exceeds the 30s budget.

This is not a slow-machine artifact: nothing else was running, and the unmutated baseline is over budget on its own.

## Why it will spread

The budget is a fixed constant while the corpus grows. `workflow-runner-resume.test.ts` is at 32s today; every co-located suite approaching 30s becomes silently unverifiable, and the failure presents as a confident, wrong diagnosis ("non-terminating mutant") rather than "I could not evaluate this".

## Decisions

- Timeout of a killing test is reported as **verification-inconclusive for that candidate**, distinct from a proven non-terminating mutant; rules out one settlement kind carrying two different meanings, one of which is false.
- Non-termination is only claimed with evidence that distinguishes it from slowness — for example the same test completing within budget on the unmutated tree, which the verifier can already measure; rules out inferring mutant behaviour from a bound the baseline also exceeds.
- The per-candidate bound is derived from the resolved killing test's observed unmutated runtime (with a floor and a ceiling) rather than a fixed 30s; rules out a constant that a growing suite silently outgrows.
- An inconclusive candidate does not strand publication on its own; it is recorded on the run so the operator can see what was not verified; rules out a deterministic fixed point that `resume` cannot clear.
- `MAX_VERIFICATION_MS` remains the overall ceiling, unchanged; rules out unbounded verification while relaxing the per-candidate bound.

## Acceptance criteria

- [ ] A test proves a killing test whose *unmutated* run already exceeds the per-candidate budget settles an inconclusive outcome naming the measured baseline, not `non_terminating_mutation_failed`; it fails against the current unconditional timeout classification.
- [ ] A test proves a genuinely non-terminating mutant (unmutated baseline well within budget, mutated run exceeding it) still settles `non_terminating_mutation_failed`.
- [ ] A test proves the per-candidate bound scales with the resolved killing test's observed runtime, and is clamped by a floor and a ceiling.
- [ ] A test proves an inconclusive candidate is recorded on the run and does not by itself settle the run non-publishable.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-candidate budget derivation and the inconclusive-versus-non-terminating distinction.
- `v2/docs/operator-runbook.md` — § Mutation verification: a timeout is not proof of a non-terminating mutant; check the unmutated killing-test runtime before believing it, and note that resume is a fixed point while the baseline exceeds the bound.
- `v2/docs/v1-behaviors.md` — record the changed settlement.
