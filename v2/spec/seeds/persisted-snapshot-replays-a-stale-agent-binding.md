# A run replaying a persisted snapshot ignores machine-profile changes

## Problem

A run that continues from a **persisted write snapshot** replays the agent binding recorded in that
snapshot, so a machine-profile rung change never reaches it. Newly-admitted runs on the same daemon
pick the new rung up immediately — the divergence is per-run, not per-daemon, and nothing surfaces
which binding a given run is carrying.

This bites hardest on re-dispatch: `--reset-despite-dirty` and `role_timeout` recovery both reuse
the completed write step's checkpoint, which is exactly the path an operator takes *after* changing
a rung to fix the failure they just hit. The rung change silently does not apply to the retry.

Observed 2026-07-25 after #2133 raised the claude implement rung from haiku to sonnet-5: on one
unrestarted daemon, two runs admitted after the merge resolved the **new** rung, while `1dded26b`
— re-dispatched with `--reset-despite-dirty` — replayed haiku across three attempts spanning 30
minutes. So the profile is re-read per admission; the loader is not the problem, and a daemon
restart is not the fix.

The symptom is silent: `jarvis run list` shows nothing about bindings, and the only way to tell which
rung a run is using is reading `adapterModel` out of `telemetry.jsonl` after the fact.

## Decisions

- A run continuing from a persisted snapshot must resolve its agent binding against current machine
  config, not replay the recorded one — or must be explicitly opted out. Rules out the observed
  silent replay, which defeats a rung change made specifically to fix the failure being retried.
- If replay is deliberate (reproducibility of a resumed run), say so and make it visible: the run
  row must report the binding it is carrying and that it diverges from current config. Rules out a
  choice that is only discoverable by reading telemetry after the run finishes.
- `--reset-despite-dirty` resets the workspace; decide and document whether it also resets the
  persisted binding. Rules out a flag whose name implies a clean slate while silently preserving
  stale model selection.
- Out of scope: `~/.jarvis/config.json` (`agents`, `machineProfile`) — untested here; check whether
  it shares the behavior when planning.

## Acceptance criteria

- [ ] A run resumed or re-dispatched from a persisted write snapshot after a rung change resolves the
      **new** rung; a test that edits the profile between the first attempt and the retry asserts the
      new `adapterModel` and fails against the pre-fix replay.
- [ ] A newly-admitted run continues to pick up the current rung with no daemon restart (pin the
      behavior that already works, so a fix cannot regress it).
- [ ] The run row reports the resolved agent and model for the active attempt, so the binding is
      visible without reading telemetry; removing the field fails a test.
- [ ] If binding replay is retained for any path, a test pins which path and asserts the divergence is
      reported on the row.

## Documentation updates

- `v2/docs/agent-model-config.md` — when a rung edit takes effect, and how to confirm which rungs are
  live.
- `v2/docs/operator-runbook.md` — when a rung change applies (new admissions) and when it does not
  (runs replaying a persisted snapshot); how to confirm which binding a run is using.
