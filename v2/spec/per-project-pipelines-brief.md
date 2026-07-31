# Per-project pipelines — build brief

Phase **shipped and dogfooded** (2026-07-31). Operator ordering and follow-on gaps: [implement-queue.md](implement-queue.md). **Do not send this brief to `plan`** — historical contract reference; fan new work from seeds or dated specs in the queue.

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
| 8 | Branch-keyed stage persistence + multi-file handoff | shipped #2374 #2379 |
| 9 | Intent-split fan-out execution | shipped #2385 |
| 10 | Branch-aware `list` / `wait` / `approve` / `reject` | shipped #2406 |
| 11 | `--seed <path>` identity and consumption | shipped #2409 #2411 |

`jarvis pipeline start | list | wait | approve | reject | resume` is usable end to end (#2352), **including a splitting intent** — the normal intent outcome, which slices 1–7 did not cover (#2385, #2406).

## Follow-on (dogfooding gaps) — all shipped

These surfaced after the phase gate closed, from running a real seed through `full-review`.
Each is now shipped and its seed consumed; kept for provenance.

| Gap | Outcome |
| --- | --- |
| Intent split must fan out downstream stages | shipped #2385 (+ #2374, #2379 persistence and handoff) |
| Branch-keyed stage records | shipped #2374 |
| Multi-file intent downstream handoff | shipped #2379 |
| Branch-aware operator CLI | shipped #2406 |
| `pipeline start --seed` loses file identity and never consumes the seed | shipped #2409, #2411 (+ #2407 context field) |
| Stale pipeline config blocks unrelated `implement` | shipped #2399 |

No known pipeline gap is open. New work fans from seeds or dated specs in
[implement-queue.md](implement-queue.md).

## Operator UI

Pipeline operator surface is the [TUI build brief](tui-overhaul-brief.md): pipeline-first monitor with nested runs. CLI remains for scripting; the TUI is the interactive path.
