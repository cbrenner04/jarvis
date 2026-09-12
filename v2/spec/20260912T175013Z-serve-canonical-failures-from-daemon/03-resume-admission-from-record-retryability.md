# Resume admission derives from record retryability

## Problem

`resolveRunResumeAdmission` (`v2/src/daemon/daemon-run-resume-admission.ts`) gates resume solely on `composeRunOperatorError(...).nextAction === "resume"` (`v2/src/daemon/run-operator-error.ts`). `list`, `wait`, and the entry-workflow projection (`projectWorkflowEntryResult` in `v2/src/daemon/daemon.ts`) already share this one admission answer — `projectWorkflowEntryResult` only ever downgrades it for a non-resumable tail, it does not recompute independently — so there is no existing divergence between what a row advertises and what `run resume` will do. The gap is upstream of all of them: the durable record's `retryable`, the value a producer actually settled, feeds none of this. `composeRunOperatorError`'s per-reason mapping can say `resume` for a run whose stored record settled a fixed point (`retryable: false`), and can say `stop` for a run whose stored record settled retryable evidence — and because every caller shares the composer, that wrong answer surfaces consistently everywhere at once.

## Behavior

When a run's stored `OperatorFailureRecord` exists, its `retryable` gates the answer `composeRunOperatorError` produces, ahead of its own per-reason mapping: `retryable: false` yields a non-`resume` `nextAction` and refuses admission; `retryable: true` proceeds exactly as today, including resume-context reconstruction. Because `resolveRunResumeAdmission`, `list`'s `resumable`/`error.nextAction`, `wait`'s `resumable`/`error.nextAction`, and `projectWorkflowEntryResult`'s downgrade all read through `composeRunOperatorError`/`resolveRunResumeAdmission`, fixing the one source corrects all of them without new call sites. Rows with no stored record keep today's per-reason-only answer.

## Decisions

- Widen `composeRunOperatorError`'s `RunWithAttempts` run parameter (`v2/src/daemon/run-operator-error.ts`) to carry `operatorFailureRecord`, and consult it before the per-reason mapping; rules out adding a second retryability computation in `daemon-run-resume-admission.ts` that could drift from what `list`/`wait` display, since those already call the same composer directly for `error`.
- `retryable: true` still passes through resume-context reconstruction, and an unreconstructable context refuses `unsupported`; rules out admitting a resume that cannot be replayed and would repeat unchanged.
- The finalization-tail resume contexts (intent finalization, review mutation, exhausted-red, out-of-scope, non-terminating, completion-commit) keep admitting ahead of the composer/record check — they return in `resolveRunResumeAdmission` before `composeRunOperatorError` is ever called; rules out a non-retryable publication record suppressing a tail resume that is known-replayable on its own evidence.
- `projectWorkflowEntryResult` needs no code change: it already only downgrades the entry result it's given, and that result already carries the corrected `resumable`/`error` once the composer is fixed; rules out re-deriving retryability a second time in the projection.

## Task checklist

- [ ] Widen the composer's run parameter type and consult `operatorFailureRecord.retryable` in `v2/src/daemon/run-operator-error.ts` ahead of the per-reason mapping.
- [ ] Confirm `resolveRunResumeAdmission`, `list`, `wait`, and `projectWorkflowEntryResult` need no further change (they already read through the composer/admission).
- [ ] Tests proving the stored record overrides a disagreeing composer reason in both directions.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-resume-admission.test.ts` gains a test proving a run whose composer-derived reason alone would admit resume is refused `terminal` when its stored record is `retryable: false`, and a run whose composer-derived reason alone would refuse is admitted when its stored record is `retryable: true`; both fail against the pre-fix code, which decides purely from the composer's reason mapping and never reads the stored record.
- [ ] `v2/src/daemon/daemon-resume.test.ts` gains a test proving a run whose stored record is `retryable: false` reports `resumable: false` and an `error.nextAction` other than `resume` on its `list` row even when the composer's own reason mapping would say `resume`, and that `run resume` refuses the same run; it fails against the pre-fix code, where `error.nextAction`, `resumable`, and admission all follow the composer's reason alone.
- [ ] A test proves the symmetric case: a run whose stored record is `retryable: true` reports `resumable: true` with `nextAction: resume` even when the composer's own reason mapping alone would refuse it.
- [ ] `v2/src/daemon/daemon-resume.test.ts` finalization-tail resume tests stay green (tail admission returns before the composer/record check runs, so it is unaffected).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — retryability-derived resume admission and the shared `resumable` / `nextAction` projection.
- `v2/docs/v1-behaviors.md` — record the changed v2 resume projections.
