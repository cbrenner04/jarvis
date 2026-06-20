# Shared invocation executor for quota fallback

Route plan/review/shrink quota-fallback through `shared/invocation/execute.ts` over a v1 spawn+classify binding. Patch already calls the same `agent.run` + `applyQuotaFallbackWhenAllowed`; it shares only that spawn+classify call (via 00's separable steps) and keeps its iteration-driven loop — not the executor. Operator messages, telemetry, and exit codes stay identical.

- [x] [00 - Shared spawn+classification binding; plan core paths route through executor](./00-binding-and-plan-core.md)
- [ ] [01 - Plan fan-out and verdict-actuator route through executor](./01-plan-split-and-verdict.md)
- [ ] [02 - Review debate loop routes through executor](./02-review-loop.md)
- [ ] [03 - Shrink phase routes through executor](./03-shrink.md)
- [ ] [04 - Patch iteration loop adopts the shared binding](./04-patch-binding.md)
