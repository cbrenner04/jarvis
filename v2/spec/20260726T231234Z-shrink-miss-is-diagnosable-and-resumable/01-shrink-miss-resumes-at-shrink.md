# Post-commit shrink `contract_miss` resume at shrink

## Problem

After the pre-shrink implement commit (#1836), shrink `contract_miss` settles the
`implement~shrink` row terminal: `resumable: false`, durable `blocked`, and
operator `contract_miss` → `inspect_spec`. Resume replays the stored miss via
`committedResult` instead of re-invoking shrink; publication never runs. The
implement commit is already on disk — recovery should retry shrink only.

Post-commit shrink text-less `blocked` (`missing_blocker`) already settles
`paused` with `loop_finished.resumable: true` in the write loop and maps to
`nextAction: "resume"` in `run-operator-error.ts`. Subspec 01 does **not** change
that path unless a shared workflow-runner guard is required for uniform
`~shrink` row status; any such guard must not alter operator-error composition for
`missing_blocker`.

## Decisions

- Post-commit shrink `contract_miss` is flipped at the **workflow-runner** seam
  (same block as post-commit shrink `invocation_failure` / `failureKind: "error"`):
  `implement~shrink` settles `paused` with `loop_finished.resumable: true` and
  workflow `resumable: true` — rules out terminal `inspect_spec` / stuck
  `committedResult` replay.
- Post-commit shrink `contract_miss` only — implement-step and any non–post-commit
  `contract_miss` keep today's non-resumable classification — rules out broad
  reclassification.
- Shrink `blocked` with persisted blocker text (`blocker_text_detail` / genuine
  `blocked` outcome) stays terminal — rules out auto-retrying a real blocker.
- Resume skips the completed implement write and re-enters at shrink (then
  publication on shrink `complete`) — rules out re-invoking the implement agent.
- **Operator-error (new):** post-commit shrink `contract_miss` composes to
  `retryable: true` / `nextAction: "resume"` — rules out `inspect_spec` for that
  row. `missing_blocker` operator-error mapping is unchanged (already `resume`).
- Quota, `model_config`, write-step `contract_miss`, shrink `invocation_failure`
  kinds other than the existing post-commit error path, and shrink `blocked` with
  blocker text keep existing classifications.
- Harness may still append `## Blocker` to the spec on `contract_miss`; operators
  diagnose the miss from `contract_miss_detail` (subspec 00) and recover via
  resume-at-shrink, not by treating the appended blocker as authoritative.
- Deferred to first consumer: whether shrink bound-retries internally before
  surfacing a miss — pin when resume proves insufficient.

## Task checklist

- Extend post-implement shrink outcome handling in `workflow-runner.ts` for
  post-commit `contract_miss` (shared guard with shrink `invocation_failure`
  error resumability when practical).
- Ensure workflow resume replays shrink without implement re-invocation;
  `committedResult` must not short-circuit a resumable post-commit shrink
  `contract_miss`.
- Update `run-operator-error.ts` for post-commit shrink `contract_miss` only.
- Do not change write-loop blocker detection or `missing_blocker` settle semantics.
- Add workflow-runner, resume, operator-error, and guard-inversion tests plus
  negative/preservation guards.

## Acceptance criteria

- [x] `workflow-runner.test.ts` `post-commit shrink contract_miss is resumable` drives implement→commit→shrink `contract_miss` and asserts workflow `resumable: true`, `implement~shrink` status `paused`, and terminal `loop_finished` on the shrink run with `resumable: true` (same signals as `resumes a shrink invocation error without re-invoking implement and publishes after shrink completes`); it fails against the pre-fix code.
- [x] `workflow-runner.test.ts` `resume after post-commit shrink contract_miss retries shrink without implement` asserts implement agent invocations do not increase on resume and shrink runs again to `complete`/publication; it fails against the pre-fix code.
- [x] `workflow-runner.test.ts` `implement write-step contract_miss stays non-resumable` drives a non-shrink `contract_miss` and asserts workflow `resumable: false`; it fails against the pre-fix code if the post-commit shrink guard is applied too broadly.
- [x] `workflow-runner.test.ts` `post-commit shrink blocked with blocker text stays terminal` drives shrink `blocked` with blocker text and asserts `resumable: false` and non-resumable `loop_finished`; it fails against the pre-fix code if genuine blockers become resumable.
- [x] `workflow-runner.test.ts` `post-commit shrink missing_blocker stays resumable` drives implement→commit→shrink text-less `blocked` and asserts the same resumability signals as the shrink `invocation_failure` error test (`paused`, `loop_finished.resumable: true`, workflow `resumable: true`); it stays green on pre-fix code (preservation / parity, not a new failing-test surface).
- [x] `run-operator-error.test.ts` `post-commit shrink contract_miss composes to resume` asserts `retryable: true` and `nextAction: "resume"`; it fails against the pre-fix code.
- [x] Inverting the post-commit shrink `contract_miss` resumability guard in `workflow-runner.ts` turns `workflow-runner.test.ts` `post-commit shrink contract_miss is resumable` RED.

## Documentation updates

- `v2/docs/workflow-runner.md` — post-commit shrink `contract_miss` recovery:
  resumable at `~shrink`, resume skips implement. (Defer runbook sentences that
  cite `contract_miss_detail` until subspec 00 is merged — see `index.md`.)
- `v2/docs/operator-runbook.md` — after 00 lands: read shrink miss output via
  `contract_miss_detail` on `implement~shrink`; recover with `jarvis run resume`
  on that row instead of `inspect_spec` / replaying the stored miss.
- `v2/docs/v1-behaviors.md` — v2 implement shrink `contract_miss` resumability
  after committed write.
