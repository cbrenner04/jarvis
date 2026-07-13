# Wedged workflow kill docs

Document the wedged-workflow kill contract and list/kill coherence for
operators. Depends on [00 - Wedged workflow kill plumbing](./00-wedged-workflow-kill-plumbing.md).

## Decisions

- Describe behavior, not implementation: docs state when workflow kill works
  (wedged/reapable) vs when it is still rejected (healthy in-flight), matching
  the `reapable` discriminant from subspec 00.
- Qualify — do not delete — the workflow-started steering limitation in the
  walkthrough: healthy runs remain non-pausable and non-killable; wedged runs
  are reapable via the same `runId` `list` shows.

## Task checklist

- Update `v2/docs/daemon-host.md` live-controls section: wedged workflow kill
  contract, `reapable` semantics at operator level, list/kill coherence after
  kill.
- Update `v2/docs/first-workflow-walkthrough.md`: qualify the workflow-started
  "cannot be paused or killed live" claim for wedged recovery.
- Add a `[v2 additive]` entry to `v2/docs/v1-behaviors.md` for wedged workflow
  kill and list/kill coherence.

## Acceptance criteria

- [ ] `v2/docs/daemon-host.md` documents that a workflow-started run `list`
      reports as `live` accepts `kill` only when wedged (reapable), reaches
      durable `killed` with worktree retained, and thereafter `list` shows
      `isLive: false` for that `runId`.
- [ ] `v2/docs/first-workflow-walkthrough.md` states that healthy
      workflow-started runs still cannot be paused or killed live, and that a
      wedged workflow run (same `runId` as `list`) can be reaped with
      `jarvis run kill`.
- [ ] `v2/docs/v1-behaviors.md` records wedged workflow kill and list/kill
      coherence under `[v2 additive]`.

## Documentation updates

- `v2/docs/daemon-host.md` — wedged workflow run kill contract and list/kill
  coherence.
- `v2/docs/first-workflow-walkthrough.md` — qualify the workflow-started
  "cannot be killed" claim for wedged recovery.
- `v2/docs/v1-behaviors.md` — behavior change catalog entry.
