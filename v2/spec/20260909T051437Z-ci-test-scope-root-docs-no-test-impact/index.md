# CI test scope treats root docs as no-test-impact

`scripts/ci-test-scope.ts` `classifyChangedPaths` returns `full` for any changed path outside the recognized surfaces and `NO_TEST_IMPACT_PATTERNS`, so a one-line `AGENTS.md` or `README.md` edit drags an otherwise `v2/**`-scoped PR to the whole aggregate suite.

- [ ] [00 - Root docs are no-test-impact](./00-root-docs-are-no-test-impact.md)
