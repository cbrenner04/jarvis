# Audit and refactor the existing test suite

Backward-looking remediation: triage the process/timing-touching test files (count from the
recorded scan, not a guess), then refactor the genuine smells toward the determinism convention
(`v2/docs/test-writing.md`) in directory-clustered, suite-green steps. Mechanical and
correctness-preserving — no behavior change to code under test beyond additive DI seams.

"Suite stays green" is measured **sandbox-off** (where `.sandbox-unrunnable.test.ts` files run);
marked-exception files are expected to pass there, not runner-excluded. 00 pins this and the
coverage baseline that 05 verifies against.

- [x] [00 - Audit and triage the corpus](./00-audit-and-triage.md)
- [x] [01 - Refactor v1 agent-adapter tests](./01-refactor-agent-adapter-tests.md)
- [ ] [02 - Refactor run.test.ts determinism](./02-refactor-run-test.md)
- [ ] [03 - Refactor v1 command/integration + timing tests](./03-refactor-command-and-timing-tests.md)
- [ ] [04 - Refactor v1 mode tests](./04-refactor-mode-tests.md)
- [ ] [05 - Refactor shared + v2 tests; verify suite](./05-refactor-shared-v2-and-verify.md)
