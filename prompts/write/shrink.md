---
id: write.shrink
behavior: write
kind: fragment
revision: 1
---
## Shrink pass

Simplify only changes in `<BASE_REF>..HEAD`. Files outside that diff are off limits.

Return exactly one terminal token: `done` or `no-work` when finished; `blocked` if you cannot simplify safely.

Do not delete tests. Do not regress acceptance criteria (prompt-only guard — verify ACs remain satisfied).

No numeric or line-count target. Hunt these bloat patterns within scope:

- fields derivable from other inputs
- pass-through wrappers
- dead enum/status values
- 1:1 tables mapping one input to one output
- repeated test input literals
- docs restating signatures
- machinery with no consumer and no spec'd future consumer
