# Serve canonical failures from the daemon

Daemon run observation, pipeline-stage settlement, wire projection, and resume admission all read the durable `OperatorFailureRecord` instead of recomposing failures.

Coverage limit: only the ready gate and publication paths populate `operatorFailureRecord` today. Loop-exhausted, iteration-commit, and other patch-failure terminal causes leave the column null and take each subspec's stated composer-fallback path unchanged.

- [ ] [00-run-observation-serves-durable-record.md](./00-run-observation-serves-durable-record.md) — `list` / `wait` expose the run row's record unchanged.
- [ ] [01-linked-stage-settlement-projects-run-record.md](./01-linked-stage-settlement-projects-run-record.md) — terminal workflow stages settle with the linked entry run's record.
- [ ] [02-pipeline-unexpected-failures-settle-records.md](./02-pipeline-unexpected-failures-settle-records.md) — unexpected and resolution stage failures stop emitting `{ message }`.
- [ ] [03-resume-admission-from-record-retryability.md](./03-resume-admission-from-record-retryability.md) — one policy drives admission, `resumable`, and `nextAction`.
- [ ] [04-wire-parsers-validate-failure-records.md](./04-wire-parsers-validate-failure-records.md) — run and pipeline wire parsers reject malformed records.
