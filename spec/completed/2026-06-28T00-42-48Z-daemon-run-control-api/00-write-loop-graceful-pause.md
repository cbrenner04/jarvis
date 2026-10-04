# 00 — Graceful pause in the write-loop core

The core capability the daemon's `pause` verb sits on. `executeWriteLoop`
(`v2/src/write-loop.ts`) honors `AbortSignal` (kill) but has no *graceful* stop:
abort interrupts mid-step, which is wrong for pause. Add a boundary-checked
graceful-stop input distinct from the abort signal, plus the durable `paused`
run status and the resume branch it enables. Host-agnostic — no daemon concepts
enter the core.

This is the first consumer of the pause input (the loop's own test). The daemon
host consumes it in subspec 02.

## Decisions

- Pause is a second, separate cancellation input on `WriteLoopInput`, checked
  only at the iteration boundary; never passed to the agent step — rules out
  reusing `signal` (abort) for pause, which would interrupt the in-flight step.
- On graceful stop the in-flight step's boundary commits first, then the loop
  returns `resumable: true` with a `paused`-distinct loop outcome — rules out
  collapsing it into the existing `budget-exhausted` resumable result, which
  `list`/resume could not tell apart from an operator pause.
- `WriteLoopOutcomeKind` gains a `"paused"` variant; since both `paused` and
  `budget-exhausted` are `resumable: true`, `kind` is the sole distinguisher —
  rules out leaving callers unable to tell the two resumable outcomes apart.
- The loop sets durable run status `paused` at the graceful stop — rules out the
  daemon reaching into run-status rows for a transition the loop already owns
  (it already writes `in-progress`/`budget-soft-stopped` at its boundaries).
- Resume reads the durable record to branch: a paused run (last attempt
  committed) starts a fresh attempt and continues; an interrupted run (last
  attempt still `in-progress`, from kill/crash) re-runs that step over the dirty
  worktree — rules out resume ignoring how the step stopped.
- Add `paused` to the `RunStatus` union in both `state-store.ts` and
  `state-store-types.ts` (kept in sync) — rules out one definition drifting.
- `killed` status is NOT added here — deferred to its first consumer, the daemon
  kill verb (subspec 02).

## Task checklist

- Add `paused` to `RunStatus` in `state-store.ts` and `state-store-types.ts`.
- Add a graceful-pause input (e.g. a `pauseSignal: AbortSignal`) to
  `WriteLoopInput`; check it at the loop boundary, not inside the step.
- On pause: let the current step finish and commit its boundary, set run status
  `paused`, emit a `loop_finished` event distinguishing pause from
  budget-exhausted, return `resumable: true`.
- Confirm/extend `prepareRun` resume branching: paused → new attempt continues;
  in-progress last attempt → re-run over dirty worktree.
- Co-locate tests driving the loop with simulated bindings.

## Acceptance criteria

- [x] A pause requested mid-step lets the in-flight step finish and commit its boundary before the loop stops (the step is not aborted).
- [x] A paused loop returns a resumable result whose `WriteLoopOutcomeKind` is `"paused"` (distinct from `budget-exhausted`) and leaves the run with durable status `paused`.
- [x] Resuming a `paused` run starts a fresh attempt and continues (does not re-run the already-committed step).
- [x] Resuming a run whose last attempt is still `in-progress` (kill/crash) re-runs that step over the dirty worktree.
- [x] The abort (`signal`) path is unchanged: `write-loop.test.ts`'s abort-signal coverage stays green (abort stops the loop without committing the in-flight boundary).
- [x] `RunStatus` includes `paused` in both `state-store.ts` and `state-store-types.ts`.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Steering semantics: record that pause is a
  boundary-checked input separate from abort; Runs/state: add `paused` to the
  run status vocabulary.
- `v2/docs/write-behavior.md` — note the graceful-pause input and the
  paused-vs-interrupted resume branch.
