# Derive resume admission from the row contract

`run list` / `run wait` advertise `nextAction: "resume"` for reasons
`run resume` still refuses: a terminal row whose last committed attempt is
`invalid_token` or `missing_blocker` composes `{reason, retryable: true,
nextAction: "resume"}` but `terminalResumeBlocked` answers `terminal_run`,
because admission hand-maintains its own eligible set
(`isPublicationRetryEligible` + `hasLandingFailure` + resumable statuses).
Derive admission from the advertised row instead, so every reason that reports
`nextAction: "resume"` is admitted as it is added.

## Decisions

- Resume admission is `composeRunOperatorError(run, terminalRecord)?.nextAction === "resume"`; rules out extending the hand-maintained reason set for the two reasons that drift today, which leaves the next one to drift the same way.
- The same derived predicate gates `resumeContextForRun` snapshot reconstruction; rules out admitting a row that then fails `resume_unsupported` because eligibility is still duplicated in two places.
- `in-progress` rows (`composeRunOperatorError` → `undefined`) keep their current non-terminal admission path; rules out a rewrite where "no operator error" reads as "not resumable" and blocks live runs.
- Guard enumerates the resume-advertised reasons from `RUN_OPERATOR_ERROR_REASONS` fixtures rather than a literal list copied into the test; rules out a test table that silently stops covering a newly added reason.
- Guard fixtures are workflow-snapshot-backed so admission is the only variable; rules out fixtures whose `resume_unsupported` reconstruction failure masks a `terminal_run` regression.

## Tasks

- Replace `terminalResumeBlocked`'s hand-maintained eligibility with the derived `nextAction === "resume"` predicate, sharing it with `resumeContextForRun`.
- Add a table-driven guard in `daemon-resume.test.ts` covering every reason that composes `nextAction: "resume"`, asserting resume is not refused `terminal_run`.
- Update `v2/docs/daemon-host.md` resume/reason-table copy and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A `failed` row whose last committed attempt is `invalid_token`, and a `blocked` row whose last committed attempt is `missing_blocker`, are each accepted by `jarvis run resume`; both fail against the pre-fix code with `terminal_run`.
- [x] `v2/src/daemon/daemon-resume.test.ts` carries a guard covering every reason that `composeRunOperatorError` reports with `nextAction: "resume"` (derived from the shared eligibility helper, not a hand-copied list) and asserts no case returns `terminal_run`.
- [x] Inverting the derived admission predicate fails the guard; a row reporting `nextAction: "stop"` (`ready_flip_failed`) or `"inspect_spec"` (`agent_blocked`, `contract_miss` with no resume-advertised attempt) stays refused `terminal_run`, and inverting that refusal fails too.
- [x] `daemon-resume.test.ts` flip/settlement refusal cases and `run-operator-error.test.ts` stay green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `resume` row and operator-error reason table: admission is derived from the advertised `nextAction`, so every `resume` reason is accepted and `stop` / `inspect_spec` / `fix_config` / `retry_later` reasons are refused `terminal_run`.
- `v2/docs/v1-behaviors.md` — resume eligibility is the row contract, superseding the enumerated `landing_failed` / publication-retry baseline recorded by `resume-accepts-landing-failed`.
