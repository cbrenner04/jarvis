---
name: surface-contract-miss-reason-on-run-rows
---

# Terminal run rows name plan-draft normalizer contract-miss detail

## Problem

`contract_miss_detail` already lands in the run log, but `jarvis run list` and `jarvis run wait`
expose only `error.reason: "contract_miss"` with remediation text that tells the operator to grep
`run log`. The normalizer message written by the write contract is not on the durable row.

## Decisions

- `RunOperatorError` (or an equivalent closed field on list/wait payloads) carries the propagated
  contract-miss diagnostic — rules out a fix that only improves log events the operator must know to
  open.
- Composition reads the terminal `contract_miss_detail` for the run (same tail the log already
  stores) — rules out duplicating validation in the daemon.
- Only `contract_miss` terminals with a detail event gain the field; other operator errors stay
  unchanged — rules out widening every error row with free text.
- Deferred to first consumer: TUI rendering of the new row field — pin when log-follow needs it
  beyond raw `run log`.

## Acceptance criteria

- [ ] After a plan-draft normalizer `contract_miss`, `jarvis run wait` JSON includes the normalizer
      message on the row (not only `error.reason: "contract_miss"`); a daemon integration test fails
      against the pre-fix code.
- [ ] The same settled run's `jarvis run list` row names the message; a daemon or CLI list test
      fails against the pre-fix code.
- [ ] A `contract_miss` with no `contract_miss_detail` event keeps today's row shape; an existing
      shrink or implement contract-miss list test stays green.
- [ ] Inverting the daemon guard that projects `contract_miss_detail` onto the row turns the first
      two tests RED.

## Documentation updates

- `v2/docs/operator-runbook.md` — `contract_miss` list/wait rows name the propagated diagnostic;
  `run log` remains the full excerpt.
- `v2/docs/write-behavior.md` — cross-link row projection to `contract_miss_detail`.

## Prerequisites

- Plan-draft normalizer rejection propagates its message through contract miss (`failureReason` and
  `contract_miss_detail` carry the same text).
- A staged plan-draft normalizer `contract_miss` appends `contract_miss_detail` to the run log.
