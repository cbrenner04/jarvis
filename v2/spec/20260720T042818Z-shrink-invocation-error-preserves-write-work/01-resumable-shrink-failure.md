# Shrink invocation error after committed write is resumable

## Problem

A shrink `invocation_error` returns `invocation_failure` with `resumable:
false` (`write-loop.ts` terminal path; `committedResult` returns a failed run's
result idempotently), and `run-operator-error.ts` maps `failureKind: "error"` →
`nextAction: "stop"`, non-retryable. The workflow settles terminal `stop` even
though (per subspec 00) the implementation is now committed. The operator must
abandon and re-run the write step from scratch, re-spending tokens.

## Decisions

- A shrink `invocation_error` after a committed implement write settles resumable (`resumable: true`, operator `nextAction: "resume"`, retryable), not terminal `stop` — rules out the current terminal classification that forbids resume.
- Resume does not re-invoke the completed `implement` write step (idempotent skip per the resume contract); it re-runs only the shrink pass and, on shrink `complete`, proceeds to publication — rules out re-running the write and re-spending its tokens.
- The shrink `invocation_error` run must not be returned idempotently as a terminal failure on resume; resume must re-execute shrink — rules out `committedResult` short-circuiting the shrink run and stranding resume at the stored failure.
- Only the shrink `invocation_error` (`failureKind: "error"`) flips to resumable; quota, `model_config`, and `no_binding` shrink outcomes keep their existing classifications — rules out broadly reclassifying every shrink failure.

## Task checklist

- Settle a post-committed-write shrink `invocation_error` as resumable in the workflow result and operator-error composition.
- Make workflow resume re-invoke the shrink pass (not return the stored failure) while skipping the completed implement write step.
- Add tests covering the resumable settle and the resume→shrink→publication path.

## Acceptance criteria

- [x] A new test in `v2/src/execution/workflow-runner.test.ts` drives `implement`→`complete` (committed) then injects a shrink `invocation_error`, and asserts the workflow result is `resumable: true` (not terminal stop); it fails against the pre-fix code.
- [x] A resume test re-enters after the shrink `invocation_error`: the completed `implement` write step is not re-invoked, the shrink pass runs again, and on shrink `complete` the workflow reaches publication and settles `complete`.
- [x] A `run-operator-error.ts` test asserts a shrink `invocation_error` over a committed write composes to `retryable: true` / `nextAction: "resume"`, not `invocation_error` / `stop`.
- [x] A quota (or `model_config`) shrink outcome retains its existing operator-error classification (unchanged by this subspec).

## Documentation updates

- `v2/docs/workflow-runner.md` — recovery on shrink failure: a shrink invocation error after a committed write settles resumable; resume finishes the shrink pass (or advances past it) to publication without re-running the write step.
- `v2/docs/v1-behaviors.md` — update the v2 implement/shrink entry to note shrink-failure resumability after a committed write.
