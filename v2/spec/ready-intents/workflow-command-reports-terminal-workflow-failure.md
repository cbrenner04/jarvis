---
name: workflow-command-reports-terminal-workflow-failure
---

# Report the terminal workflow failure

## Outcome

- An attached `jarvis run workflow implement` reports the outcome of the whole workflow, including failure after an earlier constituent run completed.
- A mutation-verification failure exits non-zero; a genuinely completed workflow exits zero.

## Decisions

- Derive the attached command's final payload and exit code from the workflow's terminal outcome; rules out returning the entry or first completed constituent run as the command result.
- Include the outcome-carrying finalization run in workflow completion even when it is not an authored step; rules out declaring the workflow complete before hidden shrink or publication gates settle.
- Keep immediate run-ID, detach, and progress-stream behavior in `workflow-commands-block-the-operator-terminal`; rules out duplicating that broader CLI attachment change here.

## Acceptance criteria

- [ ] An attached multi-run implement workflow whose earlier run completes and later mutation verification fails reports `surviving_mutation_failed` with failed workflow status and exits non-zero.
- [ ] The command does not emit the earlier constituent run's `complete` outcome as its final payload.
- [ ] A regression reproduces the multi-run ordering and fails against the baseline.
- [ ] A genuinely completed multi-run workflow reports `completed` and exits zero.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — workflow-level terminal outcome and hidden-finalization ownership.
- `v2/docs/operator-runbook.md` — attached workflow exit and payload semantics.
- `v2/docs/v1-behaviors.md` — changed v2 workflow command reporting.

## Prerequisites

- A surviving-mutation verification failure settles its owning run as failed, resumable, and operator-visible with mutation detail.
