# V2 Phase 1 State Store

Pure-library SQLite state under `v2/`: bootstrap and forward-only migrations,
the first durable run/attempt/outcome model, a transactional repository API,
and boundary-checkpoint recovery semantics.

- [x] [00 - Choose SQLite bootstrap and migration ownership](./00-choose-sqlite-bootstrap-and-migration-ownership.md)
- [x] [01 - Define the durable run-step-outcome schema](./01-define-the-durable-run-step-outcome-schema.md)
- [x] [02 - Add the transactional state-store API](./02-add-the-transactional-state-store-api.md)
- [x] [03 - Define recovery semantics and recovery-oriented coverage](./03-define-recovery-semantics-and-recovery-oriented-coverage.md)
