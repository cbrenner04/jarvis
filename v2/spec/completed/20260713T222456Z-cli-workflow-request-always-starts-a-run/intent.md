---
name: cli-workflow-request-always-starts-a-run
---

# A CLI `run workflow` request always starts a new run

`jarvis run workflow <preset>` on a spec whose project/branch already has a `completed` run row
currently prints that prior run's id and exits 0 without invoking anything
(`prepareWorkflowStep` short-circuits to `{ kind: "completed" }`). Make a fresh CLI dispatch
create a new run row and invoke the agent, regardless of any prior run's durable status.

## Decisions

- Step idempotence stays scoped to workflow resume; it must not gate a new operator request.
- The observable signal is the returned run id: it is a new row, and `run log <id>` carries new
  events for this invocation.
- Applies to all presets that share `prepareWorkflowStep` (`implement`, `intent`, `plan`) — the
  fix is at dispatch, not per-preset.

## Out of scope

- Resume/dispatch semantics for a genuinely in-flight run (`in-progress`, `revising`,
  `awaiting-human`).
- Deciding whether the spec is actually complete — separate behavior.

## Prerequisites

## Documentation updates

- `v2/docs/workflow-runner.md` — a CLI request creates a run unconditionally; step idempotence
  applies only to workflow resume.
