# Gate invocations account against the iteration budget

Concurrent implement lanes invoke full-suite `bun run test:*` inside the write step's `iterationCeilingMs` without budget reservation, cross-lane serialization, or gate-only-outstanding resume — so ceiling kills at ~45m leave only the gate AC unticked and settle non-resumable.

- [ ] [00 - Agent gate shell observability](./00-agent-gate-shell-observability.md)
- [ ] [01 - Gate-invocation budget and settlement](./01-gate-invocation-budget-and-settlement.md)
