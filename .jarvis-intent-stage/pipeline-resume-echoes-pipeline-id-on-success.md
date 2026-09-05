---
name: pipeline-resume-echoes-pipeline-id-on-success
---

# Pipeline resume echoes pipeline id on success

Unsplit rationale: The stdout echo, mutation-outcome parsing, CLI tests, and operator-runbook update all live on the pipeline CLI mutation path in `v2/src/commands/pipeline.ts`; the daemon already returns `pipelineId` in the `resumed` frame and needs no contract change.

## Primary implementation surface

- `v2/src/commands/pipeline.ts`

## Prerequisites

- `pipeline_resume` returns `{ kind: "resumed", pipelineId }` on admitted continuation.
- `pipeline start` echoes the admitted pipeline id on stdout on success.

## Problem

`jarvis pipeline resume <id>` exits 0 on `resumed` but prints nothing, so operators cannot confirm admission or capture the id for `pipeline wait`/`list`; `pipeline start` already echoes the id on stdout.

## Behavior

- On `pipeline resume` success (`kind: "resumed"`), write `${pipelineId}\n` to stdout and exit 0.
- Refusal and terminal-pipeline paths keep printing the daemon `reason` on stderr and exiting non-zero unchanged.

## Decision ledger

- Echo the pipeline id on stdout for `pipeline resume` success, matching `pipeline start`'s id-on-stdout convention; rules out silent success.
- Leave exit codes and stderr refusal wording unchanged; rules out coupling this to the refusal path.
- Scope to `pipeline resume` only; rules out folding `approve`/`reject` silent-success into this intent unless incidental to the same CLI helper change.

## Acceptance criteria

- [ ] A CLI test proves `pipeline resume` on a `resumed` outcome writes the pipeline id to stdout and still exits 0; it fails against the current silent-success path.
- [ ] Refusal and terminal-pipeline cases still print the daemon reason on stderr and exit non-zero, unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the `pipeline resume` section notes it echoes the pipeline id on success.
- `v2/docs/v1-behaviors.md` — record that `pipeline resume` now echoes the pipeline id on success.
