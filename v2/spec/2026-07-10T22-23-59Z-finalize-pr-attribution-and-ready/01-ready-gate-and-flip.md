# Ready gate and draft-to-ready flip

## Problem

A completed v2 run leaves its PR draft forever; success never advances it to ready, and there is no verification gate before doing so. v2 has no ready gate. This slice runs a gate in the worktree and, only on green, flips the draft to ready.

## Decisions

- The ready gate runs in the completed run's worktree while the PR stays draft, before any `gh pr ready` call — rules out exposing an unverified PR as ready.
- A failed gate leaves the PR draft and fails finalization as a retryable boundary — rules out flipping first and rolling back, or masking a red gate as success.
- The default gate runs the project's verification command in the worktree (built-in `bun run ready`); a non-zero exit is a gate failure. Deferred to first consumer: per-project verification override and tiered/scoped test selection — pin when a caller needs it.
- `gh pr ready <branch>` reuses the existing v2 bounded transient retry (3 total attempts, flat 1000 ms backoff) — rules out a single-attempt flip that loses to a transient GitHub error.
- A `gh` response of `already ready` or `not a draft` is treated as success — rules out failing after GitHub applied the transition but its acknowledgement was lost.
- The ready flip runs only after the PR body attribution refresh completes — rules out flipping before attribution lands.
- Gate and `gh` are injectable seams — rules out tests running live verification or GitHub.

## Scope

- Add a ready-gate step, default command `bun run ready`, run in the completed run's worktree over an injectable seam.
- On green, flip draft→ready via `gh pr ready <branch>` through the existing transient-retry seam, treating `already ready` / `not a draft` as success.
- Sequence the gate and flip after body refresh; on gate failure leave the PR draft and return retryable finalization failure preserving the completed durable boundary.
- Cover green flip, red-gate no-flip, transient-retry, and lost-ack success paths with injected-seam tests.
- Update the durable PR lifecycle and v1 parity documentation.

## Acceptance criteria

- [ ] A completed run runs the ready gate in its worktree while the PR remains draft, before any `gh pr ready` call.
- [ ] A failed ready gate leaves the PR draft and returns a retryable finalization failure that leaves the durable run `completed`; `gh pr ready` is not called, and resume re-runs the gate.
- [ ] On a green gate, `gh pr ready <branch>` flips the draft PR to ready.
- [ ] The ready flip retries transient `gh` failures to 3 total attempts with flat 1000 ms backoff; a response of `already ready` or `not a draft` is treated as success.
- [ ] The ready flip runs only after the PR body attribution refresh completes.
- [ ] Ready-gate and ready-flip tests use injected gate and `gh` seams and require no live verification run or GitHub credentials.
- [ ] `v2/docs/write-behavior.md` documents the ready-gate-before-flip ordering, the default `bun run ready` gate, the draft→ready flip, retry semantics, the `already ready` / `not a draft` success guard, and gate-failure-leaves-draft semantics.
- [ ] `v2/docs/v1-behaviors.md` marks the ported ready-gate and draft→ready behaviors.

## Documentation updates

- Extend `v2/docs/write-behavior.md` (durable v2 PR lifecycle home) with the ready-gate + draft→ready behavior.
- Mark ported behaviors in `v2/docs/v1-behaviors.md`.
