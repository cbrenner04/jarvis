# Await revise dirty-worktree admission

Make the `resume` request with `decision: "revise"` dirty-worktree gate non-blocking while preserving admission outcomes.

## Decisions

- Await the dirty-worktree probe only for `resume` with `decision: "revise"`; rules out applying it to ordinary paused-run `resume`.
- Keep dirty-versus-prompt revise admission semantics unchanged; rules out altering `revise_requires_input` while changing scheduling.
- Do not cancel an in-flight Git status probe; rules out new abort semantics outside this slice.
- Serialize same-run human-decision admission through probe, revision creation, and status transition; rules out duplicate revisions or inconsistent ownership after async dispatch.
- Leave probe failure in `awaiting-human` and retryable; rules out creating a revision or setting `revising` before the dirty result is known.

## Tasks

- [ ] Thread an asynchronous dirty-worktree dependency through `resume` `decision: "revise"` admission only.
- [ ] Make concurrent same-run human-decision requests linearizable while a revise dirty probe is pending.
- [ ] Add a real IPC/server-dispatch regression that holds the dirty probe pending and receives `health` before release.
- [ ] Document revise-admission responsiveness in the daemon contract and parity catalog.

## Documentation updates

- Update `v2/docs/daemon-host.md` with awaited dirty-worktree admission and concurrent IPC responsiveness.
- Update `v2/docs/v1-behaviors.md` with a parity record linking to the daemon contract; do not duplicate responsiveness semantics.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` stays green for ordinary paused-run resume without a dirty-worktree probe.
- [ ] `v2/src/daemon/daemon-revise.test.ts` stays green for dirty-versus-prompt outcomes, including `revise_requires_input`, after the awaited probe settles.
- [ ] Concurrent same-run human-decision requests create at most one revision and leave human-step status and worktree ownership consistent.
- [ ] A dirty-probe failure creates no revision, leaves the human step `awaiting-human`, and a later revise can proceed.
- [ ] A `health` RPC dispatched through the real daemon server responds before a held revise dirty-worktree probe releases.
- [ ] `v2/docs/daemon-host.md` owns revise-admission responsiveness; `v2/docs/v1-behaviors.md` records parity without duplicating the contract.
