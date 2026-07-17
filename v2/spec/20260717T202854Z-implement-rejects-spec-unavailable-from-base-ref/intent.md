---
name: implement-rejects-spec-unavailable-from-base-ref
---

# Reject implement specs unavailable from the base ref

`jarvis run workflow implement --spec <path>` must reject a spec that exists from the operator's cwd but is not tracked at that project-relative path in the requested base ref. The rejection occurs before daemon contact, worktree creation, or agent invocation and names the path and its absence from the base ref.

## Decisions

- Validate the spec's checkout reachability in `--base`, not only its existence under the registered project root; rules out accepting gitignored paths such as `.worktree/<name>/...` that a fresh run worktree cannot contain.
- Report an actionable CLI-time argument error, not a later `harness_failure`; rules out spending an agent iteration before discovering the bad path.

## Prerequisites

## Out of scope

- Routing-read error text when a base-tracked spec later becomes missing or unreadable.
- Absolute `--spec` support policy.

## Documentation updates

- `v2/docs/workflow-runner.md` — document cwd resolution and base-ref checkout validation.
- `v2/docs/operator-runbook.md` — replace the temporary project-root launch warning with the shipped rejection behavior.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement preflight behavior.
