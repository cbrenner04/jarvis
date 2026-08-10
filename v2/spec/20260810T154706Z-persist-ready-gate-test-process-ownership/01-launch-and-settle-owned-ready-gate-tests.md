# Launch and settle owned ready-gate tests

## Problem

A ready-gate test command currently has no durable, launch-scoped ownership record, so a retry can overlap a prior invocation and a daemon loss can leave its descendants unaccounted for.

## Decision ledger

- Every durable-run ready-gate launch creates a fresh `crypto.randomUUID()` fence before spawn and never reuses it on retry or resume. Rules out a stale completion identifying a later attempt.
- Launch the gate in its own process group behind a startup barrier. Capture the leader's canonical `readProcessBirthToken(pid)` value after spawn, persist the valid ownership record, then release the test command; on capture or registration failure, do not release it and synchronously terminate and join the wrapper. Rules out test execution without durable ownership.
- An active-record conflict fails the new attempt without releasing its test command. A retry or resume proceeds only after the prior invocation has settled and its exact fence was cleared. Rules out concurrent process groups for one run.
- On every settled invocation path, compare-and-clear the exact run and fence after joining the group. Rules out an older completion clearing a later invocation.
- Preserve ready-gate selection, environment, command order after launch, output/error mapping, repair policy, and healthy finalization. Rules out using ownership as gate-policy control.

## Tasks

- Thread durable run identity through ready-gate execution and add a managed process-group launcher with a testable startup barrier and `readProcessBirthToken(pid)` provider.
- Persist valid ownership before releasing `bun run ready`; fail closed and clean up the unreleased wrapper when persistence cannot authorize the launch.
- Clear only the settled launch's exact ownership record after the process group is joined on success, failure, timeout, cancellation, and registration-conflict cleanup.
- Cover launch ordering, fresh-fence conflict handling, settlement clear, and unchanged healthy ready-gate behavior in `v2/src/execution/ready-finalize.test.ts`.

## Acceptance criteria

- [ ] This baseline-failing regression proves a valid dedicated group is recorded with a newly generated fence and canonical leader identity before the barrier permits `bun run ready`, and its in-test `// @mutate` that releases before registration makes the scoped suite fail; `v2/src/execution/ready-finalize.test.ts` — `persists ready-gate ownership before releasing the test command`; Keystone checkpoint:
- [ ] This regression proves conflicting concurrent or stale registration leaves the earlier record and runs no second test command, and its in-test `// @mutate` that accepts the conflict makes the scoped suite fail; `v2/src/execution/ready-finalize.test.ts` — `does not start a retry while its prior ready-gate invocation remains active`; Mutation checkpoint:
- [ ] This regression proves success, error, timeout, and cancellation clear only their own post-join record, and its in-test `// @mutate` that clears before join or without the fence makes the scoped suite fail; `v2/src/execution/ready-finalize.test.ts` — `clears the settled ready-gate invocation by exact fence`; Mutation checkpoint:
- [ ] `v2/src/execution/ready-finalize.test.ts` — `runs the ready gate then flips the draft PR on green` stays green, including existing scope/environment and ready-gate output behavior.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` describe the durable launch and fail-closed cleanup boundary without changing ready-gate policy.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` with the durable ownership lifecycle and its gate-policy isolation.
