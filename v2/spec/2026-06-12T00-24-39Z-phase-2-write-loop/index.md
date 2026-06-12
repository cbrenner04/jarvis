# Write loop, durable state, and resume

Phase 2 of v2: wrap the single-pass write step in a resumable behavior loop,
standing up the SQLite state store (first rows only) and the kill/crash resume
path it needs. Source of truth: Phase 2 in `v2/spec/v2-meta-index.md` and
`v2/docs/v2-build-order.md`; semantics in `v2/docs/v2-architecture.md`
(Output contract, Runs/state, Persistence, Recovery, Steering).

- [x] [00 - Durable state store (first rows)](./00-state-store.md)
- [ ] [01 - Write loop over the single step](./01-write-loop.md)
- [ ] [02 - Kill/crash resume](./02-resume.md)
