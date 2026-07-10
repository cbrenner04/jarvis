# Ready gate and draft-to-ready flip

## Problem

A completed v2 run leaves its PR draft forever; success never advances it to ready, and there is no verification gate before doing so. v2 has no ready gate. This slice runs a gate in the worktree and, only on green, flips the draft to ready. It runs after slice 00's body refresh (see that slice's post-publish ordering).

## Decisions

- The ready gate runs in the completed run's worktree while the PR stays draft, before any `gh pr ready` call — rules out exposing an unverified PR as ready.
- A failed gate leaves the PR draft and fails finalization as a retryable boundary — rules out flipping first and rolling back, or masking a red gate as success.
- The default gate runs the project's verification command in the worktree (built-in `bun run ready`); a non-zero exit is a gate failure. Deferred to first consumer: per-project verification override and tiered/scoped test selection — pin when a caller needs it.
- A missing `ready` script and a failing one are deliberately not distinguished: any non-zero exit is coarsely "not ready" (parity with the existing missing-`gh` precedent). Deferred to first consumer: distinguishing missing-vs-red — pin when a caller needs it.
- The gate runs unbounded. Deferred to first consumer: gate timeout/cancellation — pin when a caller needs it.
- `gh pr ready <branch>` reuses the existing v2 bounded transient retry (3 total attempts, flat 1000 ms backoff) — rules out a single-attempt flip that loses to a transient GitHub error.

### Ready-flip success detection (R2)

The reused retry helper classifies every non-`non-fast-forward` error as transient and retries to exhaustion. A raw `already ready` / `not a draft` response would therefore burn all attempts and fail finalization. To prevent that, the flip wraps the `gh` call so that success detection **short-circuits before** the transient classifier:

- Exit-0 (including the common already-ready case where `gh pr ready` prints nothing) → success, no retry.
- A thrown `gh` error whose combined stdout+stderr contains (case-insensitive substring) `already ready` **or** `not a draft` → treated as success, no retry, before the error reaches the transient classifier.
- Any other thrown error → handed to the existing transient classifier (retry) unchanged.

This ordering rules out a benign lost-acknowledgement response failing finalization.

- The ready flip runs only after slice 00's PR body attribution refresh completes — rules out flipping before attribution lands.
- Gate and `gh` are injectable seams — rules out tests running live verification or GitHub.

## Post-publish boundary (shared with slice 00)

Gate+flip is a **separate** finalization boundary that runs only after the publication boundary (push+PR+refresh) succeeds:

- Order: refresh (slice 00) → ready gate → draft→ready flip.
- A gate failure (or a flip failure that is not the success-guarded case) leaves the PR draft, keeps the durable run `completed`, and returns a retryable finalization failure reason `ready_finalize_failed` (`nextAction: resume`), distinct from slice 00's `completion_commit_failed`.
- On resume the publication boundary replays first (idempotent), then the gate re-runs and, on green, the flip re-attempts; the flip's `already ready` / `not a draft` guard makes re-flip idempotent.

## Scope

- Add a ready-gate step, default command `bun run ready`, run in the completed run's worktree over an injectable seam; any non-zero exit is a gate failure.
- On green, flip draft→ready via `gh pr ready <branch>` through the existing transient-retry seam, with the success guard above short-circuiting before the transient classifier.
- Sequence the gate and flip after body refresh; on gate/flip failure leave the PR draft and return retryable `ready_finalize_failed` preserving the `completed` durable boundary.
- Cover green flip, red-gate no-flip, transient-retry, and lost-ack (`already ready` / `not a draft` / empty exit-0) success paths with injected-seam tests.
- Update the durable PR lifecycle and v1 parity documentation.

## Acceptance criteria

- [ ] A completed run runs the ready gate in its worktree while the PR remains draft, before any `gh pr ready` call.
- [ ] A failed ready gate (any non-zero exit; missing and red gate scripts are not distinguished) leaves the PR draft and returns a retryable `ready_finalize_failed` finalization failure that leaves the durable run `completed`; `gh pr ready` is not called, and resume re-runs the gate.
- [ ] On a green gate, `gh pr ready <branch>` flips the draft PR to ready.
- [ ] The ready flip treats a `gh` response whose combined stdout+stderr contains (case-insensitive) `already ready` or `not a draft`, and an empty exit-0 response, as success without retry, short-circuiting before the transient classifier; any other transient `gh` failure retries to 3 total attempts with flat 1000 ms backoff.
- [ ] The ready flip runs only after the PR body attribution refresh (slice 00) completes.
- [ ] Ready-gate and ready-flip tests use injected gate and `gh` seams and require no live verification run or GitHub credentials.
- [ ] `v2/docs/write-behavior.md` documents the ready-gate-before-flip ordering, the default `bun run ready` gate, the coarse missing-vs-red non-distinction, the unbounded gate, the draft→ready flip and retry semantics, the `already ready` / `not a draft` / empty-exit-0 success guard sitting before the transient classifier, the `ready_finalize_failed` retryable boundary, and gate-failure-leaves-draft semantics.
- [ ] `v2/docs/v1-behaviors.md` marks the ported ready-gate and draft→ready behaviors.

## Documentation updates

- Extend `v2/docs/write-behavior.md` (durable v2 PR lifecycle home) with the ready-gate + draft→ready behavior and the `ready_finalize_failed` boundary.
- Mark ported behaviors in `v2/docs/v1-behaviors.md`.
