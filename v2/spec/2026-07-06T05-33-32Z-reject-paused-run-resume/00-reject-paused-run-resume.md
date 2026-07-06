# 00 — Reject paused-run resume

The daemon `resume` handler for `runStatus: "paused"` rebuilds `WriteLoopInput`
with empty `stepRules`, `expectedArtifactPath`, and `bindings`, spawns a write
loop, and the first invocation fails `no_binding`. Replace that placeholder spawn
with an explicit operator-facing rejection before any executor call. Real paused
resume lands after bindings become reconstructable from role + machine profile
(seed 08).

## Decisions

- Reject `resume` when durable `runStatus` is `"paused"` before
  `spawnWriteLoop` — rules out proceeding to a write loop that fails
  `no_binding`.
- Add closed `reason: "not_implemented"` to `RUN_OPERATOR_ERROR_REASONS` with
  `retryable: false` and `nextAction: "stop"` — rules out ad-hoc error shapes and
  rules out reusing `no_binding` (downstream invocation failure, not a resume
  guard).
- Resume RPC failure uses correlated `error` frame `code: "not_implemented"` and
  operator-facing `message`; durable run status stays `"paused"` — rules out
  silent success (`{ ok: true }`) and rules out demoting the run to `failed`.
- Scope is the paused-run placeholder in `resume` only (`daemon.ts` ~888–904) —
  rules out binding-rebuild machinery and rules out implementing seed 08 resume
  reconstruction in this slice.
- `awaiting-human`, `revising`, `terminal_run`, `worktree_claimed`, and
  `invalid_params` resume paths unchanged — rules out regressing human-loop or
  admission guards.
- Deferred to first consumer: whether `killed` / `budget-soft-stopped` resume
  through the same placeholder get the same rejection in this slice — pin when
  seed 08 or a follow-up needs it.
- Deferred to first consumer: whether `ErrorFrame` gains an optional `error`
  field carrying `{ reason, retryable, nextAction }` on resume rejection — pin
  when CLI/TUI need structured operator detail beyond `code`/`message`.

## Task checklist

- Extend `RUN_OPERATOR_ERROR_REASONS` (and `isRunOperatorError` validation)
  with `not_implemented`.
- In `resume`, when `run.status === "paused"`, return
  `{ kind: "error", code: "not_implemented", message: … }` instead of building
  empty `WriteLoopInput` and calling `spawnWriteLoop`.
- Add in-process handler test: paused run → `not_implemented`, executor not
  invoked, status remains `paused`.
- Update `daemon-start-list.test.ts` paused-admission case to expect
  `not_implemented` instead of success.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `resume` on a durable `paused` run returns correlated RPC `error` with
  `code: "not_implemented"` and does not invoke the write-loop executor.
- [ ] After a rejected paused `resume`, durable `runStatus` remains `"paused"`.
- [ ] `isRunOperatorError` accepts `{ reason: "not_implemented", retryable: false, nextAction: "stop" }`.
- [ ] `resume` on an `awaiting-human` run without `decision` still returns
  `invalid_params`; with `decision: "approve"` still completes without spawning
  the paused placeholder path.
- [ ] `resume` on a `paused` run whose `(project, branch)` is live on another run
  still returns `worktree_claimed` before any `not_implemented` path.
- [ ] `daemon-start-list.test.ts` and `daemon-revise.test.ts` stay green except
  where paused-admission expectations change for this rejection.
- [ ] `v2/docs/v1-behaviors.md` records that paused-run `resume` returns
  `not_implemented` instead of spawning a write loop.
- [ ] `v2/docs/daemon-host.md` `resume` row documents `not_implemented` for
  `paused` runs and that real resume is deferred until binding reconstruction
  exists.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`
  pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — paused-run `resume` returns explicit
  `not_implemented` instead of proceeding to write-loop spawn.
- `v2/docs/daemon-host.md` — `resume` rejects `paused` runs with
  `not_implemented`; durable status unchanged; real resume deferred to binding
  reconstruction.
