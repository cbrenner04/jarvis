# Attribute role-invocation timeouts in the run row

repo: cbrenner04/jarvis

A role invocation that exceeds its wall-clock bound in `invokeReviewRole` currently surfaces as a
bare `error`, and the run settles `invocation_error` naming no role, agent, model, or bound.
Classify it distinctly and carry the attribution to the run row.

- [ ] [00 - Classify and attribute the bound-exceeded role invocation](./00-classify-role-timeout.md)
- [ ] [01 - Surface the attributed timeout on the run row](./01-surface-timeout-on-run-row.md)
