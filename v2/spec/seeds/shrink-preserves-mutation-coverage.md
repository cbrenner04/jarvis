---
name: shrink-preserves-mutation-coverage
---

# Shrink must not strand mutation coverage for publication

## Problem

The implement `shrink` step edits source and tests with no mutation re-verification, and its prompt does not forbid deleting killing tests. Publication then runs the diff-derived mutation verifier, and a survivor there settles terminal `surviving_mutation_failed` with no in-flow repair. Repair (`write.mutation-repair`, up to `MAX_MUTATION_REPAIR_ATTEMPTS`) runs only on operator `jarvis run resume`. For `importer-discovery-cap-exceeded` the only fix is a co-located `<stem>.test.ts` / `<stem>-*.test.ts` (importer scan caps at 200 candidates and fails closed), yet neither repair prompt names that path or explains the cap: `write.mutation-repair` says only "Fix the test coverage"; `write.surviving-mutation-reprompt` says "add or extend a co-located killing test" without naming the file.

## Evidence

- Telemetry lane `20260930T152036Z-roll-and-retain-monthly-telemetry`: write row `828283c4` got in-loop `surviving_mutation_reprompt` (`importer-discovery-cap-exceeded`, `work-boundary-telemetry.ts:83`); the agent added co-located `work-boundary-telemetry.test.ts` (+36, `dd3b9b810`) and settled done. Shrink row `74c6fa62` (`62e607264`) deleted that test file (-36) and reshaped the source. Publication row `b1cbb5ba` settled `surviving_mutation_failed` at `work-boundary-telemetry.ts:95`, killing set `[]`, no repair iteration, no reprompt event.
- Whitespace lane `20260930T152357Z-mutation-verifier-ignores-whitespace-only-line-changes`: write row `f3729435` (`bd112edf1`) added guards to `diff-scan.ts` with tests only in importer `diff-derived-mutation-verifier.test.ts`; settled done with no reprompt. Shrink row `2cb0de7d` (`e054b3c55`) rewrote `diff-scan.ts`. Publication row `7c09430b` settled `surviving_mutation_failed` at `diff-scan.ts:102` after one ready-gate repair, no mutation repair.
- Both hand-finished by adding the co-located test file.

## Decisions

- Shrink may not delete or empty a test file that is the resolved killing test (exact-stem or `<stem>-*`) for any production file in the run diff; enforce by running the diff-derived mutation verifier after shrink and reverting/repair-prompting on a new survivor, not by prompt wording alone.
- A publication-time `surviving_mutation_failed` runs the bounded `write.mutation-repair` loop in-flow before settling terminal, same budget as resume.
- Both mutation reprompt templates render a per-kind fix line: for `importer-discovery-cap-exceeded` and `missing-killing-test`, name the exact co-located path `<dir>/<stem>.test.ts` and state importer tests elsewhere do not count.
- Shrink prompt rules state: do not delete tests that cover changed guards.

## Acceptance criteria

- [ ] A shrink that deletes the co-located killing test for a changed guard yields a mutation reprompt/revert before publication (fixture test).
- [ ] Publication-time survivor triggers ≥1 `write.mutation-repair` iteration before terminal settlement (test asserts `iteration_started` with repair prompt id precedes `loop_finished`).
- [ ] Rendered reprompt for `importer-discovery-cap-exceeded` on `v2/src/execution/foo.ts` contains `v2/src/execution/foo.test.ts` (template render test, both templates).
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — shrink mutation re-verification; publication-time repair; per-kind reprompt fix line.
- `v2/docs/operator-runbook.md` — `surviving_mutation_failed` recovery no longer requires resume for the first repair budget.
