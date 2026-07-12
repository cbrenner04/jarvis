# 00 - Routing read falls back to the project root before the worktree exists

`runLinkedImplementStep` (`v2/src/execution/workflow-runner.ts`) resolves the
index against `getExternalWorktreePath(step.worktree)` and reads it before the
write loop — the only creator of the external worktree — has run, so the first
launch of `jarvis run workflow implement --spec <project-root>/…/index.md` dies
with `ENOENT`. Index routing is the only shape the `implement` preset builds,
so the preset cannot start at all.

## Decisions

- The routing base is the external worktree when it exists on disk, else the
  registered project root. Rules out materializing the worktree in the runner,
  which would duplicate the write loop's lock/creation path.
- Once the worktree exists (every pass after the write loop has run), all index
  and subspec reads *and* the checkbox advance use the worktree copy. The
  project-root copy is read-only, never written — index ticks must land on the
  branch, not in the operator's checkout.
- The active link is handed to the write loop as a path relative to the routing
  base, not an absolute one, so the write loop resolves it inside the worktree
  regardless of which base the routing read used. Rules out passing the
  project-root absolute path as `expectedArtifactPath`, which would make the
  artifact check inspect the operator's checkout.
- The pre-worktree read assumes the project-root index matches the index the
  worktree will check out at `baseRef` (specs are merged before implementation).
  Accept it; do not add a git-content read.

## Acceptance criteria

- [ ] `jarvis run workflow implement --spec <project-root>/…/index.md` reaches
  the write step with no external worktree on disk — the first routing read
  resolves the index against the registered project root instead of failing
  `ENOENT`.
- [ ] After the write loop creates the worktree, acceptance-criteria
  verification, the index-mutation guard, and the checkbox advance all read and
  write the worktree's copy of the index and subspec, not the project root's.
- [ ] The project-root copy of the index is unmodified after a linked implement
  step advances a checkbox.
- [ ] A new `workflow-runner.test.ts` case starts from **no worktree directory
  on disk** with the spec tree only at the project root, drives
  `runLinkedImplementStep` through the write step, and fails on the current
  code.
- [ ] Existing `workflow-runner.test.ts` linked-index cases stay green
  (worktree-present behavior unchanged by the fallback).

## Documentation updates

- `v2/docs/workflow-runner.md` — linked-subspec routing section: name the
  routing base (worktree when present, project root before first launch) and
  that the index tick lands in the worktree.
- `v2/docs/write-behavior.md` — state that the worktree is created by the write
  loop, after the runner's first routing read.
- `v2/docs/operator-runbook.md` — confirm the "`--spec` is resolved against the
  registered project root" note (line ~161) now holds for the runner too.
- `v2/docs/v1-behaviors.md` — no update: this is a v2-only defect, no documented
  v1 behavior changes.

## Out of scope

- Live pause/kill for workflow-started implement runs.
- Error naming for routing-read failures.
