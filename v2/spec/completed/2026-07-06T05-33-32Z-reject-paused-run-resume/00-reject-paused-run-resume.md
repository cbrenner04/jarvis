# 00 — Reject paused-run resume

The daemon `resume` handler for `runStatus: "paused"` rebuilds `WriteLoopInput`
with empty `stepRules`, `expectedArtifactPath`, and `bindings`, spawns a write
loop, and the first invocation fails `no_binding`. Replace that placeholder spawn
with an explicit operator-facing rejection before any executor call. Real paused
resume lands after bindings become reconstructable from role + machine profile
(seed 08).

## Prerequisites

- Seed 01 landed: v2 lean `documentation-standard` and in-process daemon-test
  defaults.
- `run-operator-error` family exists: `RUN_OPERATOR_ERROR_REASONS`,
  `isRunOperatorError`, and `composeRunOperatorError` for `list`/`wait`.

## Decisions

- Reject `resume` when durable `runStatus` is `"paused"` before
  `spawnWriteLoop` — rules out proceeding to a write loop that fails
  `no_binding`.
- Add closed `reason: "not_implemented"` to `RUN_OPERATOR_ERROR_REASONS` with
  `retryable: false` and `nextAction: "stop"` — rules out ad-hoc error shapes and
  rules out reusing `no_binding` (downstream invocation failure, not a resume
  guard).
- Resume RPC rejection: `code` and `reason` both `"not_implemented"`; operator
  `message` is exactly `Paused run resume is not yet implemented`; durable run
  status stays `"paused"` — rules out silent success (`{ ok: true }`), rules out
  demoting the run to `failed`, and rules out divergent `code`/`reason`.
- `not_implemented` is `resume` admission vocabulary only — not a composed
  `list`/`wait` `error.reason` and not a row in the composition reason table —
  rules out extending `composeRunOperatorError` or the composition table for
  this slice.
- `composeRunOperatorError` unchanged: paused rows on `list`/`wait` keep
  `resumable_pause` / `nextAction: "resume"` — rules out "fixing" the
  list/wait vs `resume` mismatch by changing composition.
- Scope is the paused-run placeholder in `resume` only (`daemon.ts` ~888–904) —
  rules out binding-rebuild machinery and rules out implementing seed 08 resume
  reconstruction in this slice.
- Seed 02 (`02-v2-dead-weight-purge`) owns the same resume-placeholder bullet:
  if seed 02 lands first, drop enum-extension tasks here; if this lands first,
  seed 02 drops its resume bullet without re-adding `not_implemented` — rules
  out duplicate enum work or conflicting implementation order.
- `awaiting-human`, `revising`, `terminal_run`, `worktree_claimed`, and
  `invalid_params` resume paths unchanged — rules out regressing human-loop or
  admission guards.
- Deferred to first consumer: whether `killed`, `budget-soft-stopped`, `queued`,
  or non-live `in-progress` resume through the shared placeholder path get the
  same rejection in this slice — pin when seed 08 or a follow-up needs it.
- Deferred to first consumer: whether `ErrorFrame` gains an optional `error`
  field carrying `{ reason, retryable, nextAction }` on resume rejection — pin
  when CLI/TUI need structured operator detail beyond `code`/`message`.

## Task checklist

- Extend `RUN_OPERATOR_ERROR_REASONS` (and `isRunOperatorError` validation)
  with `not_implemented` — skip if seed 02 already landed it.
- In `resume`, when `run.status === "paused"`, return
  `{ kind: "error", code: "not_implemented", message: "Paused run resume is not yet implemented" }`
  instead of building empty `WriteLoopInput` and calling `spawnWriteLoop`.
- Add `daemon-resume.test.ts` in-process handler test: paused run →
  `not_implemented`, executor not invoked, status remains `paused` (supplements,
  does not replace, socket admission coverage).
- Update `daemon-start-list.test.ts` paused-admission case to expect
  `not_implemented` instead of success.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [x] `resume` on a durable `paused` run returns RPC `error` with
  `code: "not_implemented"`, `message: "Paused run resume is not yet implemented"`,
  and does not invoke the write-loop executor.
- [x] After a rejected paused `resume`, durable `runStatus` remains `"paused"`.
- [x] `isRunOperatorError` accepts `{ reason: "not_implemented", retryable: false, nextAction: "stop" }`.
- [x] Paused runs on `list`/`wait` still compose `resumable_pause` /
  `nextAction: "resume"`; `composeRunOperatorError` and the composition reason
  table are unchanged.
- [x] `run-operator-error.test.ts` `resumable_pause` composition cases stay
  green.
- [x] `resume` on an `awaiting-human` run without `decision` still returns
  `invalid_params`; with `decision: "approve"` still completes without spawning
  the paused placeholder path.
- [x] `resume` on a `paused` run whose `(project, branch)` is live on another run
  still returns `worktree_claimed` before any `not_implemented` path.
- [x] `daemon-resume.test.ts` proves executor-not-invoked for paused rejection;
  `daemon-start-list.test.ts` paused-admission case expects `not_implemented`.
- [x] `daemon-revise.test.ts` stays green.
- [x] `v2/docs/v1-behaviors.md` records paused-run `resume` returns
  `not_implemented` (durable status unchanged) and `list`/`wait` paused
  discovery still surfaces `resumable_pause` until binding reconstruction (seed
  08).
- [x] `v2/docs/daemon-host.md` `resume` RPC row documents `not_implemented` for
  `paused` runs; notes `not_implemented` is not in the composition reason table;
  `list`/`wait` paused semantics unchanged until seed 08.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`
  pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — paused-run `resume` returns `not_implemented`
  (status unchanged); `list`/`wait` paused rows still `resumable_pause` until
  binding reconstruction.
- `v2/docs/daemon-host.md` — `resume` RPC row: `not_implemented` for `paused`
  runs; not a composition reason; `list`/`wait` paused discovery unchanged;
  real resume deferred to binding reconstruction.
