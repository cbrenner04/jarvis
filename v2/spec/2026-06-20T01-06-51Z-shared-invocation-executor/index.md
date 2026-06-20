# Shared invocation executor for quota fallback

Unify quota-fallback spawn + classification across patch/plan/review/shrink. Plan/review/shrink route through `shared/invocation/execute.ts`; patch shares the spawn + classification binding while keeping its iteration-driven loop. Operator messages, telemetry, and exit codes stay identical.

- [ ] [00 - Shared spawn+classification binding; plan core paths route through executor](./00-binding-and-plan-core.md)
- [ ] [01 - Plan fan-out and verdict-actuator route through executor](./01-plan-split-and-verdict.md)
- [ ] [02 - Review debate loop routes through executor](./02-review-loop.md)
- [ ] [03 - Shrink phase routes through executor](./03-shrink.md)
- [ ] [04 - Patch iteration loop adopts the shared binding](./04-patch-binding.md)
