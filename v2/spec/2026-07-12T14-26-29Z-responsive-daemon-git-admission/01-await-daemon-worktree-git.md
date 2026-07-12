# Await daemon worktree Git

Move daemon-hosted external-worktree setup, reuse validation, and branch probes onto the shared asynchronous runner.

## Decisions

- Await every Git probe and mutation on the external-worktree path; rules out leaving reuse validation or branch discovery synchronous.
- Keep setup and cleanup ordering unchanged; rules out parallelizing dependent Git commands.
- Leave completion publication and ready-gate Git synchronous in this slice; rules out expanding admission work into terminal publication.

## Tasks

- [ ] Propagate asynchronous Git helpers through external-worktree materialization, reuse checks, branch probes, and callers that host those operations in the daemon.
- [ ] Add a daemon-level regression that holds a worktree Git command pending and observes another IPC request complete before it releases.
- [ ] Record the awaited daemon worktree boundary in the durable architecture and parity catalogs.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with non-blocking daemon-hosted worktree Git.
- Update `v2/docs/v1-behaviors.md` with the changed daemon worktree behavior.

## Acceptance criteria

- [ ] `v2/src/execution/external-worktree.test.ts` stays green for branch, lock, and failure outcomes after awaited Git probes settle.
- [ ] An unrelated daemon IPC request completes while a daemon-hosted external-worktree Git command is pending.
- [ ] `v2/docs/v2-architecture.md` and `v2/docs/v1-behaviors.md` document awaited daemon worktree Git.
