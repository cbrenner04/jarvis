# Surface implement review selection

Persist the effective choice so consumers can distinguish an unreviewed implement run from a configured one.

## Decisions

- Persist the resolved count in workflow snapshot metadata; rules out recomputing from mutable config after launch.
- Expose the same metadata on daemon list rows and TUI run data; rules out list-only observability.
- Keep the value numeric even when zero; rules out conflating an explicit no-review selection with missing metadata.

## Tasks

- [ ] Add effective implement review-pass metadata to the durable workflow snapshot.
- [ ] Thread it through daemon list serialization and the TUI's run-data model.
- [ ] Cover persistence, list output, and TUI-facing snapshot projection for zero and positive values.

## Documentation updates

- [ ] Update `v2/docs/daemon-host.md` with the list metadata contract.

## Acceptance criteria

- [ ] Every workflow-started implement run retains its resolved numeric `reviewPasses`, including `0`, in durable workflow metadata.
- [ ] Daemon `list` output and TUI run data expose the retained `reviewPasses` without rereading project configuration.
- [ ] `v2/src/persistence/state-store.test.ts`, daemon list tests, and the affected TUI data-model tests cover the retained value.
