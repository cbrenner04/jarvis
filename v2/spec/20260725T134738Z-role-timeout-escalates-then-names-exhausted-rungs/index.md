# Role timeout escalates rungs, then names them when exhausted

repo: cbrenner04/jarvis

A review-role wall-clock overrun today settles on the first binding while later
rungs stay unreachable (quota-only advancement). Escalate through the configured
binding list on timeout, then settle with an operator error that names every
rung tried when none succeed.

- [x] [00 - Escalate review-role wall-clock timeout through remaining rungs](./00-escalate-role-timeout-through-rungs.md)
- [x] [01 - Exhausted-rung timeout names rungs and stops retry](./01-exhausted-rung-timeout-settlement.md)
