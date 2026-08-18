# 01 - Per-file budget carries a measured margin

## Problem

`SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000` is asserted as a literal in `test/test-slices.test.ts` and described in `v2/docs/operator-runbook.md` as a permanent floor sized against `v1/test/run.test.ts` at ~120s. Nothing ties the number to a measurement or a margin: `validatePerFileTimeout` only rejects values below the literal, so the number can be restated without re-measuring, and the file it was sized against is not the slowest file under the lane membership subspec 00 lands. The `workflow-runner.test.ts` timeout was diagnosed as "raise the budget until the timeout stops firing" precisely because the budget has no stated derivation.

## Decision ledger

- The anchor is the slowest measured file in the runner's roster with lane membership applied (lane files measured isolated, pooled files measured under the pool), not the slowest lane file alone; a lane-only anchor is weaker than the existing 180s floor and would license lowering the budget below `v1/test/run.test.ts`.
- 180_000 stays a hard floor: the margin rule may raise `SUPPORTED_HEALTHY_FILE_BUDGET_MS` but never lower it, so both checks bind and the effective floor is their max. Rules out reading the margin rule as permission to shrink the budget when the anchor measures fast.
- The anchor and margin are parameters of `validatePerFileTimeout` defaulting to the module constants; rules out a check that can never be observed while the 180s floor dominates, which is what makes the margin rule testable at all.
- `SUPPORTED_HEALTHY_FILE_BUDGET_MS` stays a literal, with the derivation asserted by test rather than computed from the anchor; rules out a computed constant that silently moves when someone edits the measurement without review.
- The margin is 1.5x, matching the 180s/120s ratio the current budget already carries; rules out picking a new ratio that silently reclassifies today's budget as under-margin.

## Task checklist

- Measure, on this branch with subspec 00's lane membership applied, each lane file's isolated wall clock and the slowest pooled file's wall clock; take the maximum as the anchor.
- Add `SLOWEST_MEASURED_FILE_MS` (the measured anchor, with the measuring file, command, and date in its doc-comment) and `FILE_BUDGET_MARGIN` to `scripts/run-v2-tests.ts`.
- Extend `validatePerFileTimeout(timeout, slowestMeasuredMs = SLOWEST_MEASURED_FILE_MS, margin = FILE_BUDGET_MARGIN)` to reject a timeout below `slowestMeasuredMs * margin` in addition to the existing budget floor, keeping the margin comparison on one physical line.
- Set `SUPPORTED_HEALTHY_FILE_BUDGET_MS` to the smallest value satisfying both the 180_000 floor and the margin rule, and update `test/test-slices.test.ts`'s literal budget assertion only if that value changed.
- Add the margin-rule tests to `scripts/run-v2-tests.test.ts` with in-body `// @mutate` directives.
- Update `v2/docs/test-writing.md` and `v2/docs/operator-runbook.md` with the derivation.

## Acceptance criteria

- [ ] `scripts/run-v2-tests.test.ts` test `the per-file budget carries the documented margin over the slowest measured file` fails against the pre-fix code and passes after: `validatePerFileTimeout(200_000, 180_000, 1.5)` throws naming the anchor and margin (200_000 clears the 180_000 floor but not the 270_000 margin, so the pre-fix single-argument function does not throw), `validatePerFileTimeout(400_000, 120_000, 1.5)` does not throw, and `SUPPORTED_HEALTHY_FILE_BUDGET_MS` is greater than or equal to both `180_000` and `SLOWEST_MEASURED_FILE_MS * FILE_BUDGET_MARGIN`, so lowering the budget constant below the documented anchor's margin turns this test red.
- [ ] `scripts/run-v2-tests.test.ts` — `the per-file budget carries the documented margin over the slowest measured file`; Keystone checkpoint: an in-body `// @mutate scripts/run-v2-tests.ts "slowestMeasuredMs * margin" -> "0"` directive reverts the budget to an undocumented literal floor with no margin over any measurement, so the under-margin timeout is accepted and this test turns red.
- [ ] `scripts/run-v2-tests.test.ts` — `the per-file budget carries the documented margin over the slowest measured file`; Mutation checkpoint: an in-body `// @mutate scripts/run-v2-tests.ts "timeout < slowestMeasuredMs * margin" -> "timeout > slowestMeasuredMs * margin"` directive inverts the margin guard so an over-margin timeout is rejected, proving the guard's negative case — that a budget clearing the margin is admitted — is asserted, and turning this test red.
- [ ] `SLOWEST_MEASURED_FILE_MS`'s doc-comment in `scripts/run-v2-tests.ts` names the file it was measured from, the command, and the measurement date.
- [ ] Existing `scripts/run-v2-tests.test.ts` `validatePerFileTimeout` tests and `test/test-slices.test.ts` test `policy parity: aggregate and v2 files share per-file timeout and subprocess isolation` stay green (the budget floor and the runner's per-file timeout wiring are unchanged by this derivation).
- [ ] `v2/docs/test-writing.md` records the per-file budget's derivation: the measured anchor with its file and date, the 1.5x margin, that 180_000 is a floor the margin rule may raise but never lower, and that a new slowest file forces a re-measure rather than a raised literal.
- [ ] `v2/docs/operator-runbook.md`'s per-file timeout bullet states the same derivation instead of describing 180_000 as sized against `v1/test/run.test.ts` alone, and names `validatePerFileTimeout` as the check that rejects an under-margin budget.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — per-file budget derivation: measured anchor (file, command, date), the 1.5x margin, the 180_000 floor's relationship to the margin rule, and the re-measure obligation when the slowest file changes.
- `v2/docs/operator-runbook.md` — replace the "Permanent 180-second per-file timeout floor" bullet's sizing rationale with the anchor-plus-margin derivation and name `validatePerFileTimeout`.

## Implementer notes

- Depends on subspec 00: the anchor must be measured with lane membership applied, since isolation changes the slowest file's loaded runtime.
- Keep the margin comparison on one physical line and ensure `slowestMeasuredMs * margin` appears exactly once in `scripts/run-v2-tests.ts` so both directives resolve.
- `validatePerFileTimeout` has no production caller today; wiring one is out of scope — this subspec changes its contract, not its call sites.
- Add no test-only inversion hooks; both directives mutate the real guard.
