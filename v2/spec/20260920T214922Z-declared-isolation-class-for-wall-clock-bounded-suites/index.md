# Test-slice scheduling isolates poll-until-done and subprocess-spawning suites as a declared class

`v2/src/commands/workflow.test.ts` (poll-until-done loops, e.g. `waitForCompletion`, under bunfig's 30000 ms per-test timeout) and `v2/src/execution/diff-derived-mutation-verifier.test.ts` (up to `MAX_CONCURRENT_VERIFIER_TEST_RUNS` nested real `bun test` pools) pass alone and fail together on an idle machine. A boolean roster (`LOAD_SENSITIVE_FILES`) can say "runs alone" but not "never with that set"; add an in-file declared class and a schedule that enforces mutual exclusion, executed by `scripts/run-v2-tests.ts`. Scoped to the v2 lane.

- [ ] [00-declared-isolation-class-and-runner-schedule.md](./00-declared-isolation-class-and-runner-schedule.md)
