# Project contract_miss_detail onto list and wait rows

## Problem

Plan-draft normalizer `contract_miss` already writes `contract_miss_detail.failureReason`
to the run log, but `jarvis run list` and `jarvis run wait` expose only
`error.reason: "contract_miss"` and remediation text that sends the operator to
`jarvis run log`.

## Decision ledger

- `RunOperatorError.contractMissDetail` carries the propagated contract-miss diagnostic —
  rules out a fix that only improves log events the operator must know to open.
- Composition reads the chronologically last `contract_miss_detail.failureReason` for the
  run from the log tail — rules out duplicating validation in the daemon.
- Only composed `contract_miss` errors gain `contractMissDetail` when that log event carries
  `failureReason`; other operator errors stay unchanged — rules out widening every error row
  with free text.
- `list` and `wait` share one composer and one log-tail selection rule — rules out divergent
  wait-only or list-only projection.
- Deferred to first consumer: TUI rendering of `contractMissDetail` — pin when log-follow
  needs it beyond raw `run log`.

## Task checklist

- Add optional `contractMissDetail` to `RunOperatorError`.
- Select the tail `contract_miss_detail.failureReason` from persisted log records and thread
  it through `composeRunOperatorError`.
- Wire log-tail lookup in daemon `list` / `wait` composition (injectable `logReader` path).
- Add daemon integration coverage for plan-draft normalizer `contract_miss`; extend
  `run-operator-error.test.ts` for composition and guard inversion.
- Update durable docs.

## Acceptance criteria

- [ ] `daemon-wait-run-completion.test.ts` adds a plan-draft normalizer `contract_miss`
      regression that drives a settled run through `wait` and asserts
      `error.contractMissDetail` carries the normalizer message (not only
      `error.reason: "contract_miss"`); it fails against the pre-fix code.
- [ ] `daemon-start-list.test.ts` or `daemon-wait-run-completion.test.ts` adds a list
      regression for the same settled run asserting `error.contractMissDetail` matches
      `wait`; it fails against the pre-fix code.
- [ ] `run-operator-error.test.ts` `composeRunOperatorError returns agent_blocked and contract_miss
      from loop_finished` stays green (`contract_miss` without `contract_miss_detail.failureReason`
      keeps today's row shape).
- [ ] Inverting the guard that projects `contract_miss_detail.failureReason` onto
      `contractMissDetail` turns the first two tests RED.

## Documentation updates

- `v2/docs/operator-runbook.md` — `contract_miss` list/wait rows expose
  `error.contractMissDetail`; `run log` remains the full excerpt.
- `v2/docs/write-behavior.md` — cross-link row projection to
  `contract_miss_detail.failureReason`.
- `v2/docs/daemon-host.md` — optional `error.contractMissDetail` on `contract_miss` list/wait
  rows sourced from the tail `contract_miss_detail` log event.
- `v2/docs/v1-behaviors.md` — v2 parity delta for contract-miss row projection.
