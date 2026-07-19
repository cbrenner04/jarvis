# Partition v1 run-command tests

Scope reduced to subspecs 00-03 (operator recovery, 2026-07-19): two independent
implement attempts each self-blocked (`contract_miss`) after completing exactly
00-03 in one iteration without continuing to a second. Both attempts' 00-03 work
independently verified green (typecheck, full file, and isolated). Subspecs 04-05
(loop/timeout/blocker tests, review tests) are re-seeded as
`v1/spec/seeds/partition-v1-run-command-tests-remaining.md` for a fresh run.

- [x] [00 - Partition completion-gate tests](./00-partition-completion-gate-tests.md)
- [x] [01 - Partition invocation-routing tests](./01-partition-invocation-routing-tests.md)
- [x] [02 - Partition linked-subspec and PR tests](./02-partition-linked-subspec-and-pr-tests.md)
- [x] [03 - Partition failure and preflight tests](./03-partition-failure-and-preflight-tests.md)
