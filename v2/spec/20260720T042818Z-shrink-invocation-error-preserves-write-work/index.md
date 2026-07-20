# Shrink invocation error preserves and recovers completed write work

repo: cbrenner04/jarvis

In `jarvis run workflow implement`, the implement write step commits nothing;
the hidden shrink pass and publication own the only commit. A shrink
`invocation_error` after a successful write settles terminal `stop`, stranding
finished implementation uncommitted and forcing a from-scratch re-run.

- [ ] [00 - Commit implement write output before the shrink pass](./00-commit-write-before-shrink.md)
- [ ] [01 - Shrink invocation error after committed write is resumable](./01-resumable-shrink-failure.md)

## Out of scope

- The shrink pass's own retry/timeout budget (`review-and-shrink-steps-have-no-timeout`).

Land 00 before 01: 01's resume path relies on the completed implement write run
being committed by 00.
