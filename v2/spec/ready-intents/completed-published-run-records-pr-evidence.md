---
name: completed-published-run-records-pr-evidence
---

# A completed published run records its PR evidence

Some workflow runs commit and push their branch, report `completed`, and create no
PR or error. The terminal row contains no evidence that publication occurred.

Reproduce the `findOrCreatePr` no-PR path before fixing it. A Git-enabled workflow
that pushes a branch reaches `completed` only after a matching PR is confirmed; the
terminal record and `run list` carry its number and URL. Missing PR evidence is a
named publication failure, not silent success.

## Decisions

- Require confirmed PR existence before a pushed workflow reports `completed`; rules out treating a pushed branch alone as successful publication.
- Persist the confirmed PR number and URL on the terminal record and expose them through `run list`; rules out requiring a live `gh` query to falsify completion.
- Fail with a named publication error when PR ensure returns without matching evidence; rules out interpreting an empty, stale, or base-mismatched lookup as “found.”

## Documentation updates

- `v2/docs/write-behavior.md` — completion publication evidence contract.
- `v2/docs/daemon-host.md` — terminal PR evidence and `run list` fields.
- `v2/docs/operator-runbook.md` — `completed` guarantees for gate and publication.
- `v2/docs/v1-behaviors.md` — record the changed v2 publication guarantee.

## Prerequisites

- Publication failures preserve their normalized command cause.
- A failed ready flip terminal-settles the workflow and releases its claim.
- A completed workflow has passed its ready gate after any repair attempts.
