# Audit and refactor the existing test suite

> **PARKED (2026-06-21).** The run blocked at subspec 00: the agent ran the full `bun run test`
> during the doc-only audit and hit the flaky `watchdog_descendants_alive` timing test — the very
> test this audit exists to fix (passes 7/0 in isolation, flakes under `--parallel`).
> Chicken-and-egg. To resume: stabilize that watchdog test first (the #15 DI-seam pattern — it's
> subspec 02's job; do it standalone), then run the audit. Or instruct subspec 00 not to run the
> full suite (it's doc-only).

Backward-looking remediation: triage the process/timing-touching test files (count from the
recorded scan, not a guess), then refactor the genuine smells toward the determinism convention
(`v2/docs/test-writing.md`) in directory-clustered, suite-green steps. Mechanical and
correctness-preserving — no behavior change to code under test beyond additive DI seams.

"Suite stays green" is measured **sandbox-off** (where `.sandbox-unrunnable.test.ts` files run);
marked-exception files are expected to pass there, not runner-excluded. 00 pins this and the
coverage baseline that 05 verifies against.

- [x] [00 - Audit and triage the corpus](./00-audit-and-triage.md)
- [x] [01 - Refactor v1 agent-adapter tests](./01-refactor-agent-adapter-tests.md)
- [x] [02 - Refactor run.test.ts determinism](./02-refactor-run-test.md)
- [x] [03 - Refactor v1 command/integration + timing tests](./03-refactor-command-and-timing-tests.md)
- [x] [04 - Refactor v1 mode tests](./04-refactor-mode-tests.md)
- [x] [05 - Refactor shared + v2 tests; verify suite](./05-refactor-shared-v2-and-verify.md)
