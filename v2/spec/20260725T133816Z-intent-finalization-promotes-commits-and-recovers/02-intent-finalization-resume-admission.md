# 02 - Admit a populated intent stage for resume

## Problem

Intent runs that failed after review with finished markdown still in `.jarvis-intent-stage/` settle
`unsupported_resume_context` / `nextAction: "stop"`, so `jarvis run resume` refuses. Operators
recovered by hand-copying staged files (#2109, and three more times on 2026-07-25).

This subspec covers **admission only** — teaching resume to accept the row. Subspec 03 covers what
resume then does. The two were one subspec that exceeded the write-loop iteration wall on three
consecutive dispatches; splitting them is the fix.

## Decisions

- `jarvis run resume <runId>` targets the failed intent workflow's authoritative durable completion
  row — the same `runId` `list` / `wait` show after publication-tail redirection (split write step),
  which must carry subspec 01's `landing_failed` (or equivalent) with `nextAction: "resume"` and
  `retryable: true` when the stage is populated; rules out resuming a non-authoritative review-only row.
- Admit populated-stage intent finalization `landing_failed` through the shared resume-eligibility
  helper; rules out `unsupported_resume_context` / `nextAction: "stop"` when staged intents remain,
  and rules out a resume-only admission predicate that `list` / `wait` do not share.
- Depends on subspecs 00 (promotion) and 01 (honest `error.reason` / `nextAction`), both merged.
- Scope is admission and its operator projection. Execution of the publication tail is subspec 03;
  this subspec must not implement republication.
- Out of scope: git-disabled / no-commit intent runs; recovery when the stage is empty or missing;
  `landing_failed` with an empty stage; unrelated review-step `invocation_failure` classification.

## Acceptance criteria

- [ ] `daemon-resume.test.ts` regression admits the populated-stage intent `landing_failed` row with
      `nextAction: "resume"` on the authoritative completion id, and no longer rejects it with
      `unsupported_resume_context`; it fails against pre-fix code.
- [ ] Flipping the populated-stage admission gate restores the `terminal_run` refusal, and that
      inversion turns the admission test red.
- [ ] `run wait` / `list` projection for that `runId` reports `landing_failed` with `retryable: true`
      and `nextAction: "resume"` before resume.
- [ ] A row with an **empty** stage is still refused, so admission keys on the populated stage rather
      than on the outcome kind alone.

## Documentation updates

- `v2/docs/daemon-host.md` — the `resume` RPC row: populated-stage intent finalization is admitted.
- `v2/docs/v1-behaviors.md` — intent resume gating.
