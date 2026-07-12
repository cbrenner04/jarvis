# Await dirty-worktree admission

Make the `resume`/`revise` dirty-worktree gate non-blocking while preserving its admission outcomes.

## Decisions

- Await the dirty-worktree probe inside `resume`/`revise`; rules out wrapping a synchronous Git status call behind an async handler.
- Keep dirty-versus-prompt revise admission semantics unchanged; rules out altering `revise_requires_input` while changing scheduling.
- Do not cancel an in-flight Git status probe; rules out new abort semantics outside this slice.

## Tasks

- [ ] Thread an asynchronous dirty-worktree dependency through daemon resume and revise admission.
- [ ] Add a daemon regression that holds the dirty probe pending and observes another IPC request complete before it releases.
- [ ] Document non-blocking dirty-worktree admission in the daemon contract and parity catalog.

## Documentation updates

- Update `v2/docs/daemon-host.md` with awaited dirty-worktree admission and concurrent IPC responsiveness.
- Update `v2/docs/v1-behaviors.md` with the changed daemon admission behavior.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` and `v2/src/daemon/daemon-revise.test.ts` stay green for dirty-worktree admission outcomes after the awaited probe settles.
- [ ] An unrelated daemon IPC request completes while a `resume` or `revise` dirty-worktree probe is pending.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document awaited dirty-worktree admission.
