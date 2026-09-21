---
name: implement-stage-settles-from-recovered-write-row
---

# Failed implement stage settles from its recovered write row

## Problem

When a failed implement stage's linked write row settled resumable (any kind, e.g. `gate_invocation_refused`, `surviving_mutation_failed`) and is recovered via `jarvis run resume`, the stage stays `failed` with a null PR artifact and the pipeline never advances (pipeline `a9b661d5`, row `65d57351`, PR #4013).

## Decisions

- A failed implement stage keeps its link to a resumable write row; when that row later settles, the stage settles from it (`succeeded` with its PR artifact, or `failed` again) and a success dispatches the successor.
- Non-resumable failed rows keep today's settlement.

## Acceptance criteria

- [ ] A test proves a stage whose write row settled `surviving_mutation_failed`, then was resumed and settled `completed`, settles `succeeded` with the PR artifact and dispatches its successor; it fails against the pre-fix code, which leaves the stage `failed`.
- [ ] `v2/src/persistence/pipeline-stage-settlement.test.ts` stays green (non-resumable failed rows settle as before).

## Documentation updates

- `v2/docs/operator-runbook.md` — `run resume` on a stage's write row advances the pipeline.

## Prerequisites
