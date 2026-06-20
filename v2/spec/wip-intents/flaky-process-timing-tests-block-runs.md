# Load-sensitive process-timing tests spuriously block runs

## Problem

A handful of process-spawning/timing tests fail nondeterministically under the full `bun test --parallel` suite when the machine is loaded, but pass in isolation. Because the agent runs the full suite per subspec and the completion gate runs it again, a spurious flake reads as a red gate — the agent either churns or (correctly, per discipline) raises a `## Blocker`, halting an otherwise-sound run.

## Evidence (this session)

- `split-god-modules` (F), subspec 00: agent raised a blocker citing 3 failures — 2 `DescendantTracker` tests in `reap.test.ts` and 1 `watchdog timeout … last_output_age_ms` in `run.test.ts` — and noted they also fail on the pre-refactor commit. Verified: `reap.test.ts` passes 5/5 in isolation on main; a full-suite re-run showed only 1 of the 3 failing (the watchdog one). Different subset flakes each run. The refactor is import-only relocation; typecheck clean; no real failures.
- G/H/J completed in single clean runs — they happened to draw runs where the flakes didn't trip. Luck-of-the-draw, not a real difference.

## Direction (characterize before fixing)

Identify the load-sensitive tests (`reap.test.ts` DescendantTracker; `run.test.ts` watchdog descendant/last_output_age timing) and stabilize them — generous/relative timing assertions, retry-on-timing, or serializing the process-spawning tests outside the parallel pool. Prefer fixing the timing assumption over deleting coverage. Do not mask by widening the whole suite's tolerance.

Pairs with the completion-robustness work: a gate that can distinguish a flaky failure (passes on isolated re-run) from a real one would also defuse this. See [[no-progress-stop-spares-green-work]], [[completion-commit-checkfix-output]].

## Out of scope

- Rewriting the watchdog/reaping implementation (the code under test is fine; the tests' timing assumptions are the issue).
