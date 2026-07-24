---
name: workflow-attached-run-boundary-progress
---

# Attached workflow launch emits progress at constituent run boundaries

## Problem

After admission run ID, attached workflow launches can stay silent for minutes while the first constituent run executes, so operators cannot tell whether the CLI is stuck or making progress.

## Decisions

- While **attached** and waiting for workflow entry terminal, emit one stdout line when each **constituent** run starts; rules out remaining silent until the workflow terminal JSON.
- **Constituent run** = each authored workflow snapshot step that receives its own daemon run row for operator-visible work; rules out shrink retries, hidden helper rows, and debate-only auxiliary runs.
- During attach wait (entry `wait` in flight), poll daemon `list` on a bounded interval to detect new constituent rows for the workflow entry; rules out new daemon progress events, log tailing, or splitting entry `wait` into per-step waits.
- **Line format:** one line per later constituent boundary, `workflow-step: <stepId> <runId>\n` on stdout after the admission run ID and before completion JSON; rules out stderr-only or unstructured log noise.
- Do not emit `workflow-step:` for the admitted workflow entry run ID; boundary lines are **attach-only** (detach emits none).
- Progress lines are informational only; rules out changing exit codes, wait IPC payloads, or completion JSON shape.
- Apply across workflow presets that spawn multiple constituent runs; rules out implement-only logging.
- CLI-only; rules out daemon-side progress events or TUI changes in this slice.

## Acceptance criteria

- [ ] A new regression in `workflow.test.ts` drives a multi-step **attached** workflow and asserts stdout `workflow-step:` lines appear in order for each constituent boundary after the admission run ID and before terminal JSON (entry run excluded); fails against pre-fix silent attach wait.
- [ ] Single-step attached workflow: admission run ID then completion JSON only (no `workflow-step:`).
- [ ] `--detach` launch: admission run ID only, no `workflow-step:` lines.
- [ ] Failed admission preserved: `workflow.test.ts` `run workflow implement passes through daemon guard errors without local workflow logic` stays green; no `workflow-step:` on stdout.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — attach-only boundary progress during wait (`workflow-step:` format and ordering).
- `v2/docs/operator-runbook.md` — what boundary lines mean while attached (not emitted on detach).
- `v2/docs/v1-behaviors.md` — attached workflow stdout: admission ID, optional attach-only boundary lines, terminal JSON.

## Prerequisites

- Workflow launch prints the workflow entry run ID on stdout before any attach-wait output.
- Attached `jarvis run workflow` does not exit until the workflow entry run is terminal and its final JSON describes that outcome.
