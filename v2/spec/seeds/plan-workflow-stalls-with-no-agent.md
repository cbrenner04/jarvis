# Plan workflow stalls forever after iteration_started

`jarvis run workflow plan-reviewed-light` never invokes an agent. The run wedges
permanently and cannot be killed.

## Problem

Observed 2026-07-12, reproducible both under 4-way concurrency and with a single
serial run:

1. `jarvis run workflow plan-reviewed-light --ready-intent <path> --target-dir v2/spec`
   returns a run id.
2. The external worktree is created under `~/.jarvis/worktrees/jarvis/plan/<slug>/`.
3. The structured log records exactly one event —
   `{"kind":"iteration_started","attemptId":...}` — and nothing more, indefinitely
   (observed >30 min against a 10-min `iterationTimeoutMs`).
4. **No agent subprocess is ever spawned** (`ps` shows no `codex`/`cursor`/`claude`
   child), and no session log is written.
5. `jarvis run list` reports the run `in-progress` / `live` forever.
6. `jarvis run kill <id>` returns `run_not_active` — the run is unkillable and
   leaks its worktree.

Not agent config: `codex exec` succeeds standalone, `~/.jarvis/config.json`
agent order is `codex,cursor,claude`, and `config/machines/home.json` binds every
role (`plan`, `critic`, `actuator`, …) for all three. The `intent` workflow ran
fine against the same config immediately before.

Prior evidence this predates the session: `plan/plan-workflow-intent-flag` appears
in `run list` twice — once `failed`/`no_binding` and once stalled `in-progress`/
`not-live` — the same symptom.

## Scope

- Root-cause the gap between `iteration_started` and agent spawn in the plan
  workflow's write step. Compare against the `intent` workflow's write step, which
  works against identical config.
- **No stall may be silent or unbounded.** `iterationTimeoutMs` must fire on this
  path and terminate the run with a named reason.
- A run in any non-terminal state must be killable. `run_not_active` for a run
  that `list` reports as `in-progress`/`live` is an incoherent pair — `list`
  liveness and the kill registry must agree.
- Diagnosing this required `lsof`/`ps` because daemon stderr is discarded — see
  `daemon-diagnostics-go-to-dev-null`, which should land first or alongside.

## Decisions

- Fix the stall *and* the missing timeout. A timeout alone converts a hang into a
  slow failure; the spawn gap is the actual defect.
- Killability of workflow-started runs is in scope. The walkthrough currently
  documents workflow-started runs as un-pausable/un-killable by design — that is
  acceptable for a *healthy* run, but a wedged run must still be reapable.

## Out of scope

- `plan` (non-reviewed) preset, unless it shares the defect (check it).
- Redesigning workflow step execution.

## Documentation updates

- `v2/docs/workflow-runner.md` — the spawn/timeout contract for write steps.
- `v2/docs/first-workflow-walkthrough.md` — remove or qualify the
  "cannot be killed" claim once wedged runs are reapable.
