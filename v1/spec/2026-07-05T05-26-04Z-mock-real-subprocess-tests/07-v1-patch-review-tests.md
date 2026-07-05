# v1 patch review tests

## Problem

`review.sandbox-unrunnable.test.ts` (~1700 lines after PR #1031, largest patch
suite) spawns real git/gh for review-phase plumbing. PR
[#1031](https://github.com/cbrenner04/jarvis/pull/1031) adds shared-invocation
executor actuator pins to this file; merge or rebase before converting.

## Decisions

- Mock `setupPatchReviewRepo` / `setupPatchReviewRepoWithBranchChange` git
  fixture through the subprocess boundary (same pattern as subspec 03).
- FakeAgent actuator tests need no real agent spawns; stall/orphan idle-hang
  paths may keep real subprocesses with inline justification.
- May split mocked coverage into multiple files if one file is unreviewable.

## Task checklist

- [ ] Rebase onto merged PR #1031.
- [ ] Convert bulk to mocked subprocess tests.
- [ ] Split files if needed; drop `.sandbox-unrunnable` from converted files.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh.
- [ ] Remaining real-subprocess tests justified inline.
- [ ] `review.sandbox-unrunnable.test.ts` › `actuator reuses one caller-built
      verdict prompt on every rung` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `actuator rung after idle-timeout
      advance receives fresh non-aborted signal` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `empty reviewActuatorOrder exits
      before shared execution` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `actuator falls back through
      reviewActuator order on quota` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `actuator lenient weak-quota
      fallback advances to next rung on non-final agent` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `idle watchdog escalates through
      reviewActuator when fallback rung remains` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `idle watchdog on final
      reviewActuator rung exits 11 with terminal watchdog-idle-timeout` stays
      green.
- [ ] `review.sandbox-unrunnable.test.ts` › `actuator preserves verdict and
      reverts completed spec edits` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `orphan reaping: verdict actuator
      polls and reaps via override` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` › `actuator invokes reconcile before
      push (via commitPass)` stays green.

## Documentation updates

- None.
