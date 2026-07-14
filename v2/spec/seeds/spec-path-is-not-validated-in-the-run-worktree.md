---
name: spec-path-is-not-validated-in-the-run-worktree
---

# The implement spec path is validated against the operator's cwd, then re-resolved inside the run's worktree — where it may not exist

`jarvis run workflow implement --spec <path>` resolves `<path>` relative to the operator's shell
cwd, hands the resulting **repo-relative** path to the daemon, and the runner later re-resolves that
same relative path **inside the run's own worktree** for its linked-index routing read. Nothing
checks that the path exists there until the write step is already over.

Observed 2026-07-14, run `a7e3b7d8`:

```
run_execution_failed: ENOENT: no such file or directory, open
'/Users/…/.jarvis/worktrees/jarvis/20260714T023518Z-patch-rules-require-hermetic-config-tests/.worktree/seeds-p1/v2/spec/20260714T023518Z-patch-rules-require-hermetic-config-tests/index.md'
```

The operator's cwd had drifted into a second git worktree (`.worktree/seeds-p1/`), so `--spec
v2/spec/<name>/index.md` normalized to `.worktree/seeds-p1/v2/spec/<name>/index.md`. That path is
real from the project root, so **preflight passed**. It is not real inside the run's worktree —
`.worktree/` is gitignored and never checked out — so the routing read blew up.

Cost: the run started, invoked the agent, ran a full write step for **7 minutes 52 seconds**, and
only then failed. The agent's work and its token spend were thrown away, and the run reported
`failed` / `harness_failure`, which names nothing the operator can act on.

## Decisions

- The spec path is validated **in the worktree that will consume it**, before the first agent
  invocation — not only against the project root at CLI preflight. Rules out today's "valid at
  launch, missing at routing".
- The launch is rejected when the resolved spec path is not tracked in the base ref (a path under a
  gitignored directory such as `.worktree/` can never exist in a fresh worktree). Rules out
  accepting a path that is real on the operator's disk but unreachable from any checkout.
- The rejection is a CLI-time operator error naming the path and why, not a `harness_failure` eight
  minutes in. Rules out burning an agent invocation to discover a bad argument.

## Prerequisites

- None.

## Out of scope

- The routing read's error text once the path is genuinely missing for other reasons
  (`workflow-routing-read-failure-surfaces-named-error`).
- Whether `--spec` should accept absolute paths.

## Documentation updates

- `v2/docs/workflow-runner.md` — how `--spec` is resolved, and against what.
- `v2/docs/operator-runbook.md` § Known gotchas — until this ships, launch `jarvis run workflow`
  from the project root; a cwd inside another worktree silently poisons the spec path.
