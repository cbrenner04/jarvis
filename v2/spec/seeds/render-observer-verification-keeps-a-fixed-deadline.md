---
name: render-observer-verification-keeps-a-fixed-deadline
---

# Render-observer verification still uses the fixed 30s bound that #3650 removed from killing tests

## Problem

`runDiffDerivedScopedTests` resolves its per-spawn budget as `options?.timeoutMs ?? MAX_KILLING_TEST_MS` (30_000). The killing-test path supplies a budget derived from the unmutated baseline — that is what [#3650](https://github.com/cbrenner04/jarvis/pull/3650) landed. The **render-observer** path does not: `verifyPromptRenderCoverage` calls `runScopedTests(input.worktreePath, killingTestPaths([...observerTests]))` with no options at all (`diff-derived-mutation-verifier.ts:1012` and `:1019`), so both its clean run and its mutated run fall back to the fixed 30 seconds.

Any implement that changes a registered prompt whose `render-observer-tests.ts` entry names a test file slower than 30 seconds therefore reports `render-observer-timeout` → `non_terminating_mutation_failed`, deterministically and regardless of machine load. The settlement is `resumable: true` / `nextAction: "resume"`, but resume replays the same verification against the same fixed bound, so it is a **fixed point**: the run can never clear itself, on work that is complete and green.

This is the same class the 2026-09-09 P0 closed ("fixed deadlines strand correct work"), surviving on the one path that fix did not reach. The failure is also mis-named: nothing is non-terminating: the observer test terminates fine, it is merely slower than an arbitrary constant.

## Evidence (2026-09-13)

Pipeline `a1b97b7d` (`full-review`, seed `plan-draft-contract-miss-reprompts-before-blocking`) settled its implement stage `failed`:

```text
loop_finished  loopOutcomeKind=non_terminating_mutation_failed  resumable=true
               nonTerminatingMutation="render-observer-timeout"
               nonTerminatingMutationSourceFile="prompts/write/draft-contract-reprompt.md"
               nonTerminatingMutationSourceLine=1
```

The lane's work was complete at that point: one commit, clean worktree, 11 of 11 non-human-only acceptance criteria ticked. The spec's own criterion required registering the new prompt in the observer map, and the agent did so correctly:

```ts
"prompts/write/draft-contract-reprompt.md": ["v2/src/execution/write-loop.test.ts"],
```

`v2/src/execution/write-loop.test.ts` is a 295-test file measured at **35.67 s** unmutated in this repo. So satisfying the acceptance criterion is what guarantees the timeout — the only mapping that honestly observes the rendered prompt is the file whose runtime exceeds the bound.

Note this is not the concurrency ceiling: 35.67 s exceeds 30 s on an idle machine, so the failure reproduces alone.

## Decisions

- The render-observer path derives its budget from the unmutated baseline exactly as the killing-test path does, reusing #3650's mechanism rather than a second timing policy; rules out one verification path silently keeping a constant the other retired.
- A clean run that exceeds the ceiling settles the candidate **inconclusive** and lets the run publish, matching the killing-test path's existing behaviour; rules out a slow-but-correct observer failing a complete run.
- `render-observer-timeout` stops being classified as a non-terminating mutation: a test that exceeds a budget is a timing outcome, not a proof of non-termination, and the two need different operator recoveries; rules out `nextAction: "resume"` on a settlement resume cannot clear.
- Scope is the render-observer verification budget and its settlement classification. No change to the observer map, to `MAX_PROMPT_RENDER_VERIFICATIONS`, or to killing-test resolution; rules out widening into render-coverage policy.

## Acceptance criteria

- [ ] A `diff-derived-mutation-verifier.test.ts` regression drives a changed registered prompt whose mapped observer test runs longer than `MAX_KILLING_TEST_MS` unmutated and proves verification does not settle `render-observer-timeout`; it fails against the current no-options `runScopedTests` call.
- [ ] A regression proves the render-observer clean run and mutated run both receive a baseline-derived budget, by asserting the `timeoutMs` passed to `runScopedTests` on both calls rather than only the outcome.
- [ ] A regression proves an observer whose clean run exceeds the ceiling settles inconclusive and allows publication, mirroring the killing-test contract.
- [ ] A regression proves a genuinely non-terminating observer is still reported, and is distinguishable from the timing outcome by its settlement.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — Diff-derived mutation verification: the render-observer budget derives from the unmutated baseline, and a slow observer settles inconclusive rather than non-terminating.
- `v2/docs/operator-runbook.md` — Gate trust: `render-observer-timeout` is a timing outcome, not a non-terminating mutant, and resume cannot clear the pre-fix shape.
