# Preserve committed work when a review step stalls

repo: cbrenner04/jarvis

A quiet review actuator after a committed implement write step currently settles `role_stalled` as
non-resumable and non-retryable, stranding the completion commit and adjudicated verdict. Align post-commit
`failureKind: "stall"` with the existing post-commit timeout recovery path.

- [x] [00 - Settle a stalled review step as retryable, preserving the commit and verdict](./00-stalled-review-settles-retryable.md)
