# 02 - Recover populated intent stage without re-review

## Problem

Intent runs that failed after review with finished markdown still in `.jarvis-intent-stage/` settle
`unsupported_resume_context` / `nextAction: "stop"`, so `jarvis run resume` refuses and no documented
command completes publication. Operators recovered by hand-copying staged files (#2109).

## Decisions

- `jarvis run resume <runId>` targets the failed intent workflow’s authoritative durable completion
  row — the same `runId` `list` / `wait` show after publication-tail redirection (split write step),
  which must carry subspec 01’s `landing_failed` (or equivalent) with `nextAction: "resume"` and
  `retryable: true` when the stage is populated; rules out resuming a non-authoritative review-only row.
- Resume replays finalization and completion publication (promote to `durableDir`, verdict cleanup,
  commit, push, draft PR when git-enabled) from the persisted workflow snapshot without re-entering
  the write loop or invoking split, critic, or actuator bindings; rules out `freshDispatch` review
  replay (same contract as existing `landing_failed` resume tests).
- Admit populated-stage intent finalization `landing_failed` through the shared resume-eligibility
  helper; rules out `unsupported_resume_context` / `nextAction: "stop"` when staged intents remain.
- Depends on subspecs 00 (promotion) and 01 (honest `error.reason` / `nextAction`); rules out shipping
  recovery before promotion and settlement contracts exist.
- Out of scope: git-disabled / no-commit intent runs; recovery when the stage is empty or missing;
  `landing_failed` with an empty stage (e.g. validation-only faults); unrelated review-step
  `invocation_failure` classification.

## Tasks

- Extend daemon resume admission and workflow resume dispatch for git-enabled intent finalization
  failures with a populated `.jarvis-intent-stage/`.
- Resume path: detect populated stage on the authoritative row, skip review roles and write-loop
  re-entry, run finalization + completion publication tail only (snapshot replay, not `freshDispatch`).
- Add daemon and workflow regressions; document operator recovery steps and which `runId` to resume.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `"resumes intent finalization from a populated stage without review
  re-invocation"` drives an intent workflow to a finalization failure with staged files, runs daemon
  resume on the authoritative completion `runId`, asserts `durableDir` publication, stage and verdict
  sidecar cleanup, commit, and the same push/PR publication hooks as git-enabled happy-path intent
  tests, with zero split/review agent invocations on resume; fails against pre-fix code.
- [ ] The same test asserts resume does not set `freshDispatch` and does not mint a new review
  invocation (aligned with `"daemon resume retries landing failure without re-invoking write step"`);
  inverting `freshDispatch` replay fails the test.
- [ ] `daemon-resume.test.ts` regression admits the populated-stage intent `landing_failed` row with
  `nextAction: "resume"` on the authoritative completion id and rejects
  `unsupported_resume_context` for that row; inverting admission restores `terminal_run` refusal and
  fails `"resumes intent finalization from a populated stage without review re-invocation"`.
- [ ] `run wait` / list projection for that `runId` reports `landing_failed` with `retryable: true` and
  `nextAction: "resume"` before resume, and `completed` after successful republication.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — resume/recovery semantics: which `runId` to resume after intent tail
  redirection; populated-stage finalization replay without review re-invocation.
- `v2/docs/operator-runbook.md` § Recovery — recovering an intent run that failed with a populated
  stage (`jarvis run resume <runId>`, prerequisites, expected artifacts).
- `v2/docs/v1-behaviors.md` — intent resume gating and publication recovery behavior.
