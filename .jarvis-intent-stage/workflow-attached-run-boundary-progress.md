---
name: workflow-attached-run-boundary-progress
---

# Attached workflow launch emits progress at constituent run boundaries

## Problem

After admission run ID, attached workflow launches can stay silent for minutes while the first constituent run executes, so operators cannot tell whether the CLI is stuck or making progress.

## Decisions

- While attached and waiting for workflow entry terminal, emit one stdout line when each **constituent** run starts; rules out remaining silent until the workflow terminal JSON.
- **Constituent run** = each authored workflow snapshot step that receives its own daemon run row for operator-visible work; rules out shrink retries, hidden helper rows, and debate-only auxiliary runs.
- **Observation (CLI-only):** detect step/run transitions via existing client IPC during attach wait (e.g. `wait`/`list` polling already used for workflow-terminal wait); rules out new daemon progress events or IPC methods.
- **Line format:** one line per boundary, `workflow-step: <stepId> <runId>\n` on stdout after the admission run ID and before completion JSON; rules out stderr-only or unstructured log noise.
- Progress lines are informational only; rules out changing exit codes, wait IPC payloads, or completion JSON shape.
- Apply across workflow presets that spawn multiple constituent runs; rules out implement-only logging.
- CLI-only; rules out daemon-side progress events or TUI changes in this slice.

## Acceptance criteria

- [ ] A regression test in `workflow.test.ts` drives a multi-step attached workflow and asserts stdout contains `workflow-step:` lines for each constituent run boundary in order (after admission run ID, before terminal JSON); it fails against pre-fix silent attach wait.
- [ ] A single-step workflow emits no `workflow-step:` lines beyond the admitted workflow entry run (admission ID only, then completion JSON).
- [ ] A failed admission still exits non-zero with the existing named failure and emits no boundary progress.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — boundary progress lines during attached wait (`workflow-step:` format and ordering).
- `v2/docs/operator-runbook.md` — what boundary lines mean while attached.
- `v2/docs/v1-behaviors.md` — attached workflow stdout: admission ID, optional boundary lines, terminal JSON.

## Prerequisites

- Intent `workflow-print-run-id-at-admission` implemented (stdout order: run ID → boundaries → JSON).
- Intent `workflow-attached-waits-for-terminal` implemented (attach blocks until workflow entry is terminal).
