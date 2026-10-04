---
name: publication-failure-cannot-report-completed
---

# A publication failure cannot report `completed`

A v2 implement run can commit locally, abort on the publisher's swallowed `gh auth status`
pre-check, skip push/PR/ready-gate work, and leave every durable row `completed`. Make completion
publication fail visibly: execute fallible push/`gh` work inside the existing publication retry and
normalization boundary, retain the real command evidence, and demote the completion run row so the
workflow entry cannot roll up to `completed`.

The regression must cover the workflow path that publishes after shrink: a failed publication emits
retryable `completion_commit_failed`, persists its normalized operation/message/exit/output evidence,
returns non-zero from foreground and wait surfaces, and reports the shrink row plus entry workflow as
failed. Ready finalization does not run. A successful publication still requires confirmed PR evidence
and a green ready gate before reporting `completed`.

## Decisions

- Delete the standalone `gh auth status` pre-check; rules out an unretried lossy auth probe before the evidence-bearing retry boundary.
- Demote the row carrying `completion_commit_failed` to `failed`, matching `ready_gate_failed`; rules out an unpublished workflow rolling up as `completed`.
- Persist normalized failure evidence on publisher command failure; rules out retaining only the synthetic `GitHub auth unavailable` message.
- Keep `completion_commit_failed` resumable despite the failed row status; rules out losing the existing idempotent publication recovery path.
- Attribute publication failure to the completion/shrink row and let workflow rollup derive the entry status; rules out mutating only the entry row while its failing child remains `completed`.

## Prerequisites

## Documentation updates

- `v2/docs/write-behavior.md` — publication ordering, retry/evidence boundary, failed-row semantics, and the `completed` contract.
- `v2/docs/operator-runbook.md` — Gate trust and publication recovery using persisted terminal evidence.
- `v2/docs/daemon-host.md` — workflow entry rollup and list/wait status for publication failure.
- `v2/docs/v1-behaviors.md` — record the changed v2 publication and completion-status behavior.
