---
name: implement-admission-persists-its-run-row
---

# Implement admission returns a run id whose row was never persisted

## Problem

2026-09-06: `jarvis run workflow implement … --detach` printed a run id and exited `0`; no row with that id ever existed (`run wait` → `unknown_run`), and the daemon log carried the only trace. The lane was silently lost under a contract that says exit 0 means admitted.

Root cause (audited 2026-09-18): `linkedImplementRoutingFailureOutcome` (`v2/src/execution/workflow-runner.ts`, ~:791-834) mints `existingRunId ?? crypto.randomUUID()` and reports it through `onStepRunCreated` without `store.createRun`; for `already_complete` it returns `kind: "complete"` carrying that phantom id, the daemon resolves it to the CLI, and the CLI prints it and returns. Post-#3794 not even the daemon-log line is emitted. Not touched by #3987 (owner stamping is resume-side).

## Decisions

- Admission either persists the run row before returning an id, or returns a named refusal; rules out a printed id no verb can reach.
- A routing outcome that dispatches nothing settles an operator-visible result (a durable row or a named refusal on the CLI), not a synthetic `complete` with a phantom id.

## Acceptance criteria

- [ ] A test proves implement admission whose routing dispatches no step returns a named refusal and a non-zero exit instead of printing a run id; it fails against the current phantom-id `complete`.
- [ ] A test proves every id printed by `--detach` resolves through `run wait`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — admission persistence contract for the entry run row.
- `v2/docs/operator-runbook.md` — detach exit-0 caveat.
