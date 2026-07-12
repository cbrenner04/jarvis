# implement preflight validates the spec inside a worktree that doesn't exist yet

`jarvis run workflow implement` cannot start any run. It rejects every spec at
validation, before doing any work.

## Problem

Observed 2026-07-12:

```sh
jarvis run workflow implement --base main \
  --spec v2/spec/2026-07-12T16-49-11Z-plan-draft-write-loop-prompt/index.md
```

```
invalid_params: ENOENT: no such file or directory, open
  '/Users/…/.jarvis/worktrees/jarvis/2026-07-12T16-49-11Z-plan-draft-write-loop-prompt/v2/spec/2026-07-12T16-49-11Z-plan-draft-write-loop-prompt/index.md'
```

The spec exists at the project root. The worktree does not exist — it has not been
created yet, because the run was rejected before creation. So preflight resolves
`--spec` against the **worktree** path and stats it there, which can never succeed
on a first launch. Chicken-and-egg.

This contradicts the documented contract in
`v2/docs/first-workflow-walkthrough.md`, which says `--spec` "must exist relative
to the registered project root."

The `intent` and `plan` presets do not have this bug — they resolve seed /
ready-intent paths against the project root.

## Scope

- Validate `--spec` (and `--artifact`) against the **registered project root**,
  which is where the operator's path is meaningful and where the file actually is.
- The worktree-relative path is what the *write step* consumes after the worktree
  exists; keep that, but stop using it as the precondition for creating it.
- Regression coverage: a first-launch `implement` against a spec that exists at the
  project root and has no worktree must reach the write step.

## Decisions

- Fix the resolution, not the docs. Project-root-relative is the correct operator
  contract and matches the other two presets.

## Out of scope

- Live pause/kill for workflow-started implement runs.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — confirm the `--spec` resolution root
  once it matches the documented contract.
