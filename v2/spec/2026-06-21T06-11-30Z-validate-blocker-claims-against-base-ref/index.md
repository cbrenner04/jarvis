# Validate pre-existing-failure blocker claims against the base ref

When a patch-mode `## Blocker` cites pre-existing / unrelated / baseline test
failures, reproduce them on the base ref before halting the run with exit 7.
On snapshot-heavy repos these claims were all false (base was green; a fresh
re-run passed), so the harness halted on the agent's own mid-edit churn.

- [x] [00 - Reject base-ref-failure blocker claims when base validates green](./00-reject-base-ref-blocker-claims.md)
- [ ] [01 - Reproduce cited failures on the base ref](./01-base-ref-test-reproduction.md)

## Out of scope

- Red completion-verdict (ready-gate `ready-stuck-red`, `completion-pipeline.ts`) claims
  of pre-existing failures. The stuck-red stop is a separate mechanism from blocker
  exit 7; validating its claims is deferred to a follow-up intent to keep this spec
  within the reviewability boundary.
