# Serial failure confirmation runs the live roster, never frozen `v1/`

Scoped gate failures are confirmed by re-running serially; bare `bun test` discovers frozen `v1/test/**` and does not validate live-engine health. This spec adds `bun run test:confirm:live`, points agent and operator recovery at it, and documents when to use it versus scoped `test:*` gates.

Chained subspecs (intent PR #4249 / seed `serial-rerun-includes-frozen-v1`).

- [x] [00 — Live serial confirmation runner](./00-confirm-live-test-runner.md)
- [x] [01 — Agent guidance and guidance pin test](./01-agents-serial-confirmation-guidance.md)
- [ ] [02 — Operator and catalog documentation](./02-serial-confirmation-docs.md)
