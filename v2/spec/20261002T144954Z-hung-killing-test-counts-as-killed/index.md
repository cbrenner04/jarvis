# Hung killing test counts as killed

When `bunfig.toml` per-test timeout and verifier subprocess floor both sit at 30 s, an in-test hang under a mutant can hit the subprocess wall clock first, fast baseline proves clean, and verification wrongly settles `non_terminating_mutation_failed`. One change: pass a lower Bun `--timeout` on every `runDiffDerivedScopedTests` spawn while keeping subprocess `timeoutMs` on the floor/budget/deadline.

- [x] [00 — Scoped Bun per-test timeout under subprocess floor](./00-scoped-bun-per-test-timeout.md)
