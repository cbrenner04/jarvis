# Lock timeout after write completion is resumable

A store write that still throws `database is locked` (including after `busy_timeout` expiry under contention) can land after a write loop has already committed its completion boundary. Today that path appends `run_execution_failed` and composes `harness_failure` / `nextAction: "stop"`, stranding work the operator should recover with `jarvis run resume` without re-running the finished write step.

## Decisions

- Operator contract is `error.reason: "state_store_lock_timeout"`, `retryable: true`, `nextAction: "resume"`; rules out `harness_failure` / `stop` for post-boundary store lock failures.
- Recovery is `jarvis run resume` on the failed row with the same admission as other `nextAction: "resume"` reasons (derived row contract); rules out `role_timeout`'s `retry_later` workflow re-dispatch.
- Resumable lock-timeout classification applies only when the run still carries the committed completion boundary (and associated git commit) for the finished write step; rules out blanket `resume` for every `run_execution_failed` whose message mentions SQLite lock.
- Settlement must not roll back or hide that completion boundary; rules out demoting `resumable` on the boundary row or undoing the completion commit to force `failed`.
- Out of scope: eliminating lock errors under contention (WAL + busy timeout); rules out widening this subspec into store tuning.

## Tasks

- Classify post-boundary store lock failures into `state_store_lock_timeout` on `list` / `wait` (and workflow entry rollup where applicable) instead of generic `harness_failure`.
- Keep the completed write-step boundary and its git commit intact when the lock failure settles.
- Admit the row through the existing snapshot-backed `resume` path so the completed write step is not invoked again.
- Add a contended-store regression that drives lock timeout past `busy_timeout` after a committed write-loop boundary, plus operator-error, resume, and guard-inversion coverage.
- Align `daemon-host.md`, `operator-runbook.md`, and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` (or a sibling daemon regression beside the other post-completion failure cases) contends the store past `busy_timeout` after a committed write-loop boundary and asserts `list` / `wait` report `error.reason: "state_store_lock_timeout"`, `retryable: true`, and `nextAction: "resume"` instead of `harness_failure` / `stop`; it fails against the pre-fix code.
- [ ] The same regression asserts the completion boundary and the git commit from the finished write step remain intact after the failure settles.
- [ ] `v2/src/daemon/daemon-resume.test.ts` accepts the failed row via `resume` and continues without re-invoking the completed write step; it fails against the pre-fix code.
- [ ] Inverting the lock-timeout classifier (or equivalent guard) on the contended post-boundary fixture restores `harness_failure` / `stop`; a non-lock `run_execution_failed` control stays `harness_failure` / `stop`, and inverting that refusal fails too.
- [ ] `composeRunOperatorError` / resume-admission coverage includes `state_store_lock_timeout` with `nextAction: "resume"` so derived admission does not refuse `terminal_run`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — operator-error reason table row for contended store lock timeout after write completion: `state_store_lock_timeout`, retryability, `nextAction: "resume"`; note how it differs from generic `harness_failure` on message-less `run_execution_failed`.
- `v2/docs/operator-runbook.md` — recovery when a run fails on store lock after a completed write step (`jarvis run resume`, no rewrite of the finished step).
- `v2/docs/v1-behaviors.md` — v2 operator failure semantics for store lock timeout after write commit.
