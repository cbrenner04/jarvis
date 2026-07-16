# Persist publication failure cause

Publication and ready-finalization failures currently end the durable run log with only a generic loop outcome, losing the harness boundary and command error needed for recovery.

## Decisions

- Add `publicationFailure: { step, error }` to terminal `loop_finished`, where `step` is `completion_commit`, `completion_publish`, or `ready_finalize` — rules out encoding post-agent harness failures as invocation detail.
- Persist the returned operator error message unchanged in `error`, including available command evidence — rules out a generic label or inferred cause.
- Emit the same failure detail from standalone and workflow publication paths — rules out workflow-only recovery requiring daemon stderr.
- Omit `publicationFailure` from every non-publication terminal event — rules out nullable or misleading detail on ordinary loop outcomes.

## Task checklist

- Extend the durable terminal log-event contract with publication failure detail.
- Route completion-commit, completion-publication, and ready-finalization failures through shared terminal-event construction in standalone and workflow runs.
- Add focused regression coverage for emission, omission, persistence, and CLI replay.
- Update durable operator and behavior documentation.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` fails against the baseline and proves standalone completion-commit, completion-publication, and ready-finalization failures append one terminal `loop_finished` with the matching `publicationFailure.step` and exact returned error message.
- [ ] `v2/src/execution/workflow-runner.test.ts` fails against the baseline and proves workflow completion-commit, completion-publication, and ready-finalization failures emit the same `publicationFailure` shape as standalone runs.
- [ ] Non-publication `loop_finished` events omit `publicationFailure`; successful agent invocations followed by publication failure are not reported as `invocation_failure`.
- [ ] `v2/src/cli.test.ts` proves `jarvis run log <run-id>` replays persisted publication failure detail unchanged.
- [ ] `v2/docs/operator-runbook.md` makes `jarvis run log <run-id>` authoritative for publication-failure recovery and does not direct operators to `~/.jarvis/daemon.log` for the cause.
- [ ] `v2/docs/write-behavior.md` documents the terminal publication-failure event, step values, error semantics, and identical standalone/workflow evidence.
- [ ] `v2/docs/v1-behaviors.md` records the changed v2 failure-reporting behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — run-log-first publication recovery.
- `v2/docs/write-behavior.md` — durable terminal publication-failure fields and scope.
- `v2/docs/v1-behaviors.md` — changed v2 failure reporting.
