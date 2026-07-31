# Per-project pipelines — build brief

Phase **shipped** (2026-07-31). Operator ordering and follow-on gaps: [implement-queue.md](implement-queue.md). **Do not send this brief to `plan`** — historical contract reference; fan new work from seeds or dated specs in the queue.

## Product contract

- Project selects a named pipeline in `~/.jarvis/config.json` (including required `terminalAction`).
- Pipeline definitions reference source-owned workflow presets; project config chooses composition and review posture, not arbitrary prompts or executable code.
- Examples: `intent(light) → approve → plan(debate) → approve → implement(debate) → approve`; `intent(none) → plan(none) → implement(light) → merge`.
- Human approval is a durable stage with explicit approve/reject state.
- **Daemon owns pipeline execution** — do not chain attached CLI processes.
- Each stage records stable ID, workflow invocation ID, status, start/end, artifact, failure.
- Resume restarts at the failed or awaiting-approval stage, never at pipeline start.
- Validation rejects unknown workflows, invalid review posture, missing role bindings, and impossible terminal actions before admission.
- Start with hand-edited config. `jarvis init` is a fast follow, **not** a prerequisite.

Operator walkthrough: [`first-workflow-walkthrough.md`](../docs/first-workflow-walkthrough.md) § Configured pipeline.

## Shipped slices

| # | Slice | State |
| --- | --- | --- |
| 1 | Schema + source definitions + validation | shipped #2240 #2248 |
| 2 | Durable stage state + daemon execution | shipped #2249 #2255 #2254 |
| 3 | Approve/reject + resume | shipped #2320 #2330 #2335 |
| 4 | CLI start/list/wait/detach | shipped #2304 #2310 #2328 |
| 5 | Configured final actions (draft PR / ready / merge) | shipped #2336 #2343 #2348 |
| 6 | One e2e integration proof | shipped #2352 |
| 7 | Inter-stage artifact handoff from prior worktree | shipped #2359 #2363 |

`jarvis pipeline start | list | wait | approve | reject | resume` is usable end to end (#2352).

## Follow-on (dogfooding gaps)

These surfaced after the phase gate closed; see implement-queue **Start here**.

| Gap | Seed / spec |
| --- | --- |
| Intent split must fan out downstream stages | `seeds/pipeline-intent-split-fans-out-downstream-stages.md` → `20260731T030451Z-pipeline-intent-split-fan-out-execution` (in flight) |
| Branch-keyed stage records | shipped — `20260731T012722Z-pipeline-branch-keyed-stage-records` |
| Multi-file intent downstream handoff | shipped — `20260731T021721Z-pipeline-intent-split-downstream-handoff` |
| `pipeline start --seed` loses file identity | `seeds/pipeline-start-seed-path-loses-file-identity.md` |
| Stale pipeline config blocks unrelated implement | `seeds/pipeline-config-validation-blocks-unrelated-implement.md` |

Until intent fan-out ships, a pipeline survives only a seed the intent step does **not** split.

## Operator UI

Pipeline operator surface is the [TUI build brief](tui-overhaul-brief.md): pipeline-first monitor with nested runs. CLI remains for scripting; the TUI is the interactive path.
