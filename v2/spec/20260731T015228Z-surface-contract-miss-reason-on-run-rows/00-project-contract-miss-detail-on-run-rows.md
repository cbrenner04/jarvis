# Project contract_miss_detail onto list and wait rows

## Problem

Plan-draft normalizer `contract_miss` already writes `contract_miss_detail.failureReason`
to the run log, but `jarvis run list` and `jarvis run wait` expose only
`error.reason: "contract_miss"` and remediation text that sends the operator to
`jarvis run log`.

## Prerequisites

Plan-draft normalizer rejection already propagates its message through `failureReason` /
`contract_miss_detail.failureReason`. A write-loop regression would surface here as a
confusing projection failure, not as a composition bug.

## Decision ledger

- `RunOperatorError.contractMissDetail` carries the propagated contract-miss diagnostic —
  rules out a fix that only improves log events the operator must know to open.
- `contractMissDetail` enrichment runs in the **shared list/wait composition path** (the same
  path that produces `RunOperatorError` for both surfaces), not as divergent daemon-only
  post-processing — rules out two implementations that satisfy checklist tasks but violate one
  composer / one tail rule.
- Composition reads the chronologically last `contract_miss_detail.failureReason` for the run from
  the log tail — rules out duplicating validation in the daemon.
- Log records reach that composer via one documented boundary (optional log-tail input to the
  shared composer, or a single post-compose enricher invoked from both `list` and `wait`) — one
  path, one rule, both surfaces.
- Only composed `contract_miss` errors gain `contractMissDetail` when that log event carries
  `failureReason`; other operator errors stay unchanged — rules out widening every error row with
  free text.
- When log tail cannot be read (store-only / no `logReader`), `contractMissDetail` is omitted —
  same omission pattern as other log-sourced optional fields.
- Deferred to first consumer: TUI rendering of `contractMissDetail` — pin when log-follow needs it
  beyond raw `run log`.

## Task checklist

- Add optional `contractMissDetail` to `RunOperatorError`.
- Select the chronologically last `contract_miss_detail.failureReason` from persisted log records;
  thread through the shared list/wait composer via one log-tail input boundary.
- Invoke that composition path from daemon `list` and `wait` (injectable `logReader` when available).
- Add daemon integration regression for persisted-log → list/wait row projection; extend
  `run-operator-error.test.ts` for composition preservation cases.
- Update durable docs.

## Acceptance criteria

- [ ] `daemon-wait-run-completion.test.ts` adds a settled-run regression asserting
      `error.contractMissDetail` on **both** `wait` and `list` for the same run (combined-test
      pattern, e.g. `surviving_mutation_failed`). "Plan-draft normalizer" names the motivating
      producer; the test may inject persisted `contract_miss_detail` + `loop_finished` log rows
      with the same `failureReason` text rather than driving the full write loop. Contract:
      persisted log → list/wait row projection. Fails against the pre-fix code.
- [ ] `run-operator-error.test.ts` `composeRunOperatorError returns agent_blocked and contract_miss
      from loop_finished` stays green (`contract_miss` without `contract_miss_detail.failureReason`
      keeps today's row shape).
- [ ] `run-operator-error.test.ts` adds a case where the log tail contains `contract_miss_detail`
      without `failureReason` and the composed error keeps today's shape (no `contractMissDetail`).
- [ ] Source-mutating the shared list/wait composition path to drop the
      `contract_miss_detail.failureReason` projection onto `contractMissDetail` turns the daemon
      regression RED, with a comment checkpoint at that line naming the mutation. Satisfy this by
      mutating the real guard — do **not** add a production test flag (no `setInvert*ForTest`
      export, module variable, function parameter, or input-type member); see
      `v2/spec/seeds/guard-inversion-criteria-produce-production-test-flags.md`.

## Documentation updates

- `v2/docs/operator-runbook.md` — `contract_miss` list/wait rows expose
  `error.contractMissDetail`; `run log` remains the full excerpt; omit `contractMissDetail` when
  log tail is unavailable (store-only / no `logReader`).
- `v2/docs/write-behavior.md` — cross-link row projection to
  `contract_miss_detail.failureReason`.
- `v2/docs/daemon-host.md` — optional `error.contractMissDetail` on `contract_miss` list/wait rows
  sourced from the chronologically last `contract_miss_detail` log event; omitted when tail cannot
  be read.
- `v2/docs/v1-behaviors.md` — v2 parity delta for contract-miss row projection.
