---
name: refuse-false-completed-write-loop-settlements
---

# Write-loop settlements refuse false `completed` over dirty worktrees and resume partial multi-subspec runs

A write step resolving `no-work` while its worktree holds uncommitted tracked changes must not settle
`completed`. `iteration_timeout` with at least one fully satisfied subspec must retain branch,
worktree, and iteration commits for `jarvis run resume` instead of forcing `resetStaleWorkspace`
re-dispatch.

## Bundle

Second of three serial intents from `seeds/implement-completion-honesty`; promotes after
`implement-stale-worktree-preflight-gates`, before `project-completion-honesty-on-run-results`.
Plan drafts one ordered spec from the bundle.

## Decisions

- A write step resolving `no-work` over uncommitted tracked paths settles a named non-`completed` failure listing those paths — rules out reporting success over work never committed.
- `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked settles `resumable: true` / `nextAction: "resume"`; a run with no completed subspec keeps `resumable: false` / `stop` — rules out "re-dispatch and redo" as the sole recovery.
- The timeout settlement carries a completion inventory naming completed and remaining subspec paths in durable loop output — rules out an opaque timeout with no subspec progress signal.
- Completed-subspec `iteration_timeout` recovery is `jarvis run resume` on the retained workspace — no distinct re-entry path; re-dispatch after abandon or `--reset-despite-*` overrides remains separate.
- Resume continues on the retained branch and worktree with no `resetStaleWorkspace` and no rematerialization from `--base` — rules out resume paths that discard iteration commits.

## Acceptance criteria

- [ ] A regression asserts a write step that resolves `no-work` over a worktree with uncommitted tracked paths settles a non-`completed` status naming those paths; it fails against the current boundary.
- [ ] An implement run that settles `iteration_timeout` with at least one subspec's non-human-only criteria fully ticked reports `resumable: true` / `nextAction: "resume"` in its terminal `loop_finished` record; a run with no completed subspec keeps `resumable: false` / `stop`. Inverting the completed-subspec predicate makes the regression red.
- [ ] The `iteration_timeout` terminal loop record carries a completion inventory naming each completed subspec path and each remaining one; a test pins both lists against a tree with one complete and one incomplete subspec.
- [ ] Resuming such a run continues on the retained branch and worktree — no `resetStaleWorkspace`, no rematerialization — and the pre-existing iteration commits are still reachable from the branch head after the resume settles.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the dirty-`no-work` refusal turns its pinning test RED.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the completed-subspec `iteration_timeout` resumability predicate turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row no longer admits the `no-work`-over-dirty case; state what `no-work` now settles; `iteration_timeout` is conditionally resumable.
- `v2/docs/operator-runbook.md` § Recovery — replace the "re-dispatch the workflow" guidance for completed-subspec `iteration_timeout` with resume-from-retained-workspace guidance.
- `v2/docs/v1-behaviors.md` — record the dirty `no-work` refusal and the changed `iteration_timeout` resumability contract.

## Prerequisites

- An implement re-run refuses when the managed worktree HEAD is not a descendant of the resolved `--base`.
- An implement re-run refuses when the managed worktree is behind base and has uncommitted tracked paths.
- `resetStaleWorkspace` refuses to retire a workspace whose spec tree has criteria ticked that are unticked on `--base`.
- The preserve gate is checked before the stale/dirty reuse gate on `resetStaleWorkspace`.
- The write-loop completion boundary maps agent `no-work` to `runStatus: "completed"` when no dirty-worktree guard fires.
- A tree with every subspec's non-human-only criteria ticked settles `implement.already_complete`, not `no-work`/`completed` on one subspec.
