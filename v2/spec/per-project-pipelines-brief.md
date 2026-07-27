# Per-project pipelines — build brief

Next meta-index phase after the [recovery batch](implement-queue.md#p0--recovery-batch-serialize-1--2--3). Plan this brief with `jarvis run workflow plan`, then implement. `--detach` (#2215) is on `main` — reuse its admission/detach contract for pipeline CLI surfaces.

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

1. Schema + source definitions + validation
2. Durable stage state + daemon execution
3. Approve/reject + resume
4. CLI start/list/wait/detach
5. Configured final actions (draft PR / ready / merge)
6. Docs + one e2e integration

## Serialize with TUI

Anything that extends the `run list` row contract in `write-behavior.md` (agent/model columns, workflow identity, stall flags) belongs in the [TUI overhaul brief](tui-overhaul-brief.md) or lands as thin data-field intents only when cheap.
