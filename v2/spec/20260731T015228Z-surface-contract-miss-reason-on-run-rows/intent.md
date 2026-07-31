---
name: surface-contract-miss-reason-on-run-rows
---

# Terminal run rows name plan-draft normalizer contract-miss detail

## Problem

`contract_miss_detail` already lands in the run log, but `jarvis run list` and `jarvis run wait`
expose only `error.reason: "contract_miss"` with remediation text that tells the operator to grep
`run log`. The normalizer message written by the write contract is not on the durable row.

## Decisions

- `RunOperatorError.contractMissDetail` carries the propagated contract-miss diagnostic — rules out
  a fix that only improves log events the operator must know to open.
- Composition reads the chronologically last `contract_miss_detail.failureReason` for the run (same
  tail the log already stores) — rules out duplicating validation in the daemon.
- Only `contract_miss` terminals with a `contract_miss_detail` event that carries `failureReason`
  gain `contractMissDetail`; other operator errors stay unchanged — rules out widening every error
  row with free text.
- Deferred to first consumer: TUI rendering of `contractMissDetail` — pin when log-follow needs it
  beyond raw `run log`.

## Acceptance criteria

- [ ] After a plan-draft normalizer `contract_miss`, `jarvis run wait` JSON includes the normalizer
      message in `error.contractMissDetail` (not only `error.reason: "contract_miss"`); a daemon
      integration test fails against the pre-fix code.
- [ ] The same settled run's `jarvis run list` row names the message in `error.contractMissDetail`;
      a daemon or CLI list test fails against the pre-fix code.
- [ ] `run-operator-error.test.ts` `composeRunOperatorError returns agent_blocked and contract_miss
      from loop_finished` stays green (contract_miss without `contract_miss_detail.failureReason`
      keeps today's row shape).
- [ ] Inverting the daemon guard that projects `contract_miss_detail.failureReason` onto
      `contractMissDetail` turns the first two tests RED.

## Documentation updates

- `v2/docs/operator-runbook.md` — `contract_miss` list/wait rows expose `error.contractMissDetail`;
  `run log` remains the full excerpt.
- `v2/docs/write-behavior.md` — cross-link row projection to `contract_miss_detail.failureReason`.

## Prerequisites

- Plan-draft normalizer rejection propagates its message through contract miss (`failureReason` and `contract_miss_detail.failureReason` carry the same text).
