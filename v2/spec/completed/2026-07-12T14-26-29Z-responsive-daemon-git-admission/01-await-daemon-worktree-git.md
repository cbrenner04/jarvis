# Await daemon worktree Git

Move daemon-hosted external-worktree setup, reuse validation, and branch probes onto the shared asynchronous runner.

## Decisions

- Migrate daemon `start`, killed-run `resume`, workflow dispatch/resume, and queued promotion where they enter `withExternalWorktree`; rules out migrating direct non-daemon `write` consumers.
- Await external-worktree validation, prune, branch discovery/creation, and worktree creation; rules out leaving any daemon-hosted setup Git synchronous.
- Keep setup and cleanup ordering unchanged; rules out parallelizing dependent Git commands.
- Leave completion publication and ready-gate Git synchronous in this slice; rules out expanding admission work into terminal publication.

## Tasks

- [x] Propagate asynchronous Git helpers through daemon-hosted external-worktree materialization, reuse checks, branch probes, and mutations.
- [x] Keep Git-probe failures that currently mean "not found" or "not a worktree" mapped to `false`; propagate other setup failures and release the external-worktree lock.
- [x] Add a real IPC/server-dispatch regression that holds daemon worktree Git pending and receives `health` before release.
- [x] Record the daemon worktree responsiveness boundary in its architecture home and the parity catalog.

## Documentation updates

- Update `v2/docs/v2-architecture.md` with non-blocking daemon-hosted worktree Git.
- Update `v2/docs/v1-behaviors.md` with a parity record linking to the architecture contract; do not duplicate responsiveness semantics.

## Acceptance criteria

- [x] `v2/src/execution/external-worktree.test.ts` stays green for branch and reuse outcomes after awaited Git probes settle.
- [x] A failed awaited external-worktree setup releases its lock and leaves later setup admissible.
- [x] A `health` RPC dispatched through the real daemon server responds before a held daemon-hosted external-worktree Git command releases.
- [x] `v2/docs/v2-architecture.md` owns daemon worktree responsiveness; `v2/docs/v1-behaviors.md` records parity without duplicating the contract.
