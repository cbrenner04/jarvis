# 00 - Terminal-settle a failed ready flip

`gh pr ready` failure returns `ready_flip_failed` with `resumable: true`, stays resume-eligible in the daemon, and can leave a workflow row `in-progress` with nothing live while the claim is held — remediation that cannot work for already-committed, already-published work.

## Decisions

- Settle a failed flip as a terminal non-resumable outcome (`resumable: false`, `loop_finished` recorded non-resumable); rules out the resume path replaying publication and re-running the gate for work that is already committed and published.
- Keep the durable run `completed`; rules out demoting to `failed`, which would deny the committed work and the existing PR.
- Refuse `resume` on a flip-settled run with the existing `terminal_run` error, and drop `ready_flip_failed` from publication-retry eligibility; rules out a `list`/`wait` remediation the daemon then rejects.
- Report `ready_flip_failed` as `retryable: false`, `nextAction: "stop"`; rules out `retry_later`, which implies the harness will re-attempt.
- Leave `completion_commit_failed` and `ready_gate_failed` resume-eligible; rules out generalizing non-resumability to failures resume can actually retry.
- Assert reclaim through a second `start` on the same `(project, branch)`; rules out asserting registry internals, which is what let the stranded claim go unnoticed.

## Work

- Return `resumable: false` and record a non-resumable `loop_finished` for flip failure in the write loop and workflow runner.
- Remove `ready_flip_failed` from the daemon's publication-retry resume eligibility and from `terminalResumeBlocked`'s retry set.
- Map `ready_flip_failed` to `retryable: false` / `nextAction: "stop"` while retaining `publicationFailure`.
- Cover settlement, claim release, reclaim, refused resume, and operator-error mapping.
- Align the durable documentation contracts.

## Acceptance criteria

- [x] A workflow driven to a ready-flip failure through the `readyFinalizer` seam settles: `run workflow` returns `ready_flip_failed` with `resumable: false`, no run row is left `in-progress`, and the `loop_finished` row records `resumable: false`; the test fails against the pre-fix code.
- [x] After that settlement the worktree claim is released: a second `start` on the same `(project, branch)` is accepted without a daemon restart, and the worktree, branch, and completion commit survive untouched; the test fails against the pre-fix code.
- [x] `resume` of a flip-settled run is refused as a terminal run; `completion_commit_failed` and `ready_gate_failed` runs stay resume-eligible (`daemon-resume.test.ts` covers both directions).
- [x] `list` and `wait` report `ready_flip_failed` with `retryable: false` and `nextAction: "stop"`, still carrying `publicationFailure`; `run workflow` and `run wait` still exit `1`.
- [x] `v2/src/execution/ready-finalize.test.ts` stays green — retry policy, `already ready` / `not a draft` guards, and `ReadyGateError` repair routing are unchanged by this subspec.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` document the non-resumable flip outcome, its resume ineligibility, and claim release.

## Documentation updates

- `v2/docs/workflow-runner.md` — failed-flip workflow outcome, non-resumable.
- `v2/docs/write-behavior.md` — non-resumable ready-flip boundary and exit codes.
- `v2/docs/daemon-host.md` — terminal settlement, resume ineligibility, claim release.
- `v2/docs/v1-behaviors.md` — changed v2 flip settlement behavior.
