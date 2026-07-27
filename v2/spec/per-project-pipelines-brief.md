# Per-project pipelines — build brief

Next meta-index phase after the [recovery batch](implement-queue.md#p0--recovery-batch-serialize-1--2--3). **Do not send this brief to `plan`** — it is a brief, not a ready-intent. Each slice below has its own seed under `seeds/`; fan those out with `jarvis run workflow intent`, then `plan`, then implement. `--detach` (#2215) is on `main` — reuse its admission/detach contract for pipeline CLI surfaces.

## Product contract

- Project selects a named pipeline in `~/.jarvis/config.json`.
- Pipeline definitions reference source-owned workflow presets; project config chooses composition and review posture, not arbitrary prompts or executable code.
- Examples: `intent(light) → approve → plan(debate) → approve → implement(debate) → approve`; `intent(none) → plan(none) → implement(light) → merge`.
- Human approval is a durable stage with explicit approve/reject state.
- **Daemon owns pipeline execution** — do not chain attached CLI processes.
- Each stage records stable ID, workflow invocation ID, status, start/end, artifact, failure.
- Resume restarts at the failed or awaiting-approval stage, never at pipeline start.
- Validation rejects unknown workflows, invalid review posture, missing role bindings, and impossible terminal actions before admission.
- Start with hand-edited config. `jarvis init` is a fast follow, **not** a prerequisite.

## Minimum slices

Serialize 1 → 2 → {3, 4} → 5 → 6. Each row is a seed; docs ride with each slice.

| # | Slice | Seed |
| --- | --- | --- |
| 1 | Schema + source definitions + validation | `seeds/pipeline-definition-schema-and-validation.md` |
| 2 | Durable stage state + daemon execution | `seeds/pipeline-durable-stage-state-and-daemon-execution.md` |
| 3 | Approve/reject + resume | `seeds/pipeline-approval-stage-and-resume.md` |
| 4 | CLI start/list/wait/detach | `seeds/pipeline-cli-start-list-wait-detach.md` |
| 5 | Configured final actions (draft PR / ready / merge) | `seeds/pipeline-configured-final-actions.md` |
| 6 | One e2e integration proof | `seeds/pipeline-end-to-end-integration-proof.md` |

## Serialize with TUI

Anything that extends the `run list` row contract in `write-behavior.md` (agent/model columns, workflow identity, stall flags) belongs in the [TUI overhaul brief](tui-overhaul-brief.md) or lands as thin data-field intents only when cheap.
