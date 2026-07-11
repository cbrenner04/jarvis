# Surface implement review selection

Persist the effective choice so consumers can distinguish an unreviewed implement run
from a configured one.

## Decisions

- Persist the resolved count as a `reviewPasses` field on the workflow snapshot carried by the implement write step's run row; rules out recomputing from mutable config after launch and an unowned "metadata" bag.
- Expose `reviewPasses` as a top-level numeric field on the daemon list row and TUI run data; rules out list-only observability.
- Non-implement workflows carry no `reviewPasses` (absent on the wire); rules out fabricating a count for workflows that have no review concept.
- Keep the value numeric even when zero; rules out conflating an explicit no-review selection with missing metadata.

## Tasks

- [ ] Add a numeric `reviewPasses` field to the durable workflow snapshot on the implement write step's run row.
- [ ] Thread `reviewPasses` through daemon list serialization and the TUI run-data model as a top-level numeric field, absent for non-implement workflows.
- [ ] Cover persistence, list output, and TUI-facing snapshot projection for zero, positive, and non-implement (absent) values.

## Documentation updates

- [x] Update `v2/docs/daemon-host.md` with the list metadata contract, including the non-implement absent case.

## Acceptance criteria

- [x] Every workflow-started implement run retains its resolved numeric `reviewPasses`, including `0` (numeric, never absent), on the durable workflow snapshot carried by its write-step run row.
- [x] Daemon `list` output and TUI run data expose the retained `reviewPasses` as a top-level numeric field without rereading project configuration.
- [x] A non-implement workflow run carries no `reviewPasses` value on the list row or TUI run data.
- [x] `v2/src/persistence/state-store.test.ts`, daemon list tests, and the affected TUI data-model tests cover the retained value including the zero and non-implement cases.
