---
name: plan-parallel-commitfalse-false-boundary-violation
---

# plan: parallel commit:false plans trip false boundary-violation on each other's spec dirs

## Problem

Running multiple `jarvis1 plan` invocations concurrently for the **same
`commit:false` project** makes all but the last-started plan fail with a spurious
boundary violation before the draft commit:

```
plan: boundary violation detected before draft commit
  - ~/.jarvis/specs/<proj>/<spec-a>
  - ~/.jarvis/specs/<proj>/<spec-b>
plan: blocked
```

Root cause: in `commit:false` mode every plan writes its spec dir into the **one
shared external spec root** (`~/.jarvis/specs/<proj>/`). The boundary check diffs
the spec root against a baseline taken at plan start and flags any dir that
*appeared during* the run. With N parallel plans, each sees the sibling spec dirs
the others are creating and treats them as out-of-boundary writes:

- plan A (baseline empty) → flags B, C → blocked
- plan B (baseline {A}) → flags C → blocked
- plan C (baseline {A,B}) → nothing new → succeeds

The detector can't tell "another concurrent plan's spec dir" from "this plan
polluting outside its boundary." Net: **`plan` is effectively non-parallelizable
in `commit:false`**, even though each plan uses its own `.worktree/plan-<name>`
worktree and the specs are independent.

Observed on `groceries-client` (`plan.commit = false`), intake issue #533.

## Direction

Scope the boundary baseline to **the current plan's own spec dir** (and its
worktree), not the entire shared external spec root — snapshot/diff only paths
under `<externalRoot>/<thisSpecName>/`. Concurrent sibling spec dirs created by
other plans should be ignored by the boundary check, letting `commit:false` plans
run in parallel (their natural state, since each has an isolated worktree).

## Out of scope

- The `commit:true` path (spec dirs live in-repo on per-plan worktrees; no shared
  external root).

## References

- Intake issue #533.
