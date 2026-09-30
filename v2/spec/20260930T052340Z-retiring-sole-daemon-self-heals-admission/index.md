# Retiring sole daemon self-heals admission

After a failed self-handoff the incumbent can stay `retiring` with the stable public listener still bound and no live successor, so admission never reopens and stable-digest backoff retries never run.

Prerequisite (committed): pending handoff rollback clears handoff-origin `supersede` and reopens admission on successful rebind — [`20260930T014709Z-handoff-rollback-restores-admission-after-handoff-supersede`](../20260930T014709Z-handoff-rollback-restores-admission-after-handoff-supersede/index.md).

- [x] [00-retiring-sole-owner-self-heal-predicate.md](00-retiring-sole-owner-self-heal-predicate.md) — exported self-heal predicate and unit coverage
- [ ] [01-stable-digest-sampling-self-heal-wiring.md](01-stable-digest-sampling-self-heal-wiring.md) — sampling-tick self-heal, regression, operator docs
