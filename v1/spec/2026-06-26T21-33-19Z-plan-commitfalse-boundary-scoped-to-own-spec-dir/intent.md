---
name: plan-commitfalse-boundary-scoped-to-own-spec-dir
---

# plan: commit:false boundary check scoped to the plan's own spec dir

## Problem

Concurrent `jarvis1 plan` runs for the same `commit:false` project trip a
spurious `boundary violation detected before draft commit`. The boundary check
baselines and diffs the entire shared external spec root
(`~/.jarvis/specs/<proj>/`), so each plan flags the sibling spec dirs other
concurrent plans create as out-of-boundary writes. All but the last-started
plan block, even though each has an isolated worktree and independent spec.

## Behavior

Scope the boundary baseline/diff to paths under the current plan's own spec dir
(`<externalRoot>/<thisSpecName>/`) and its worktree, not the whole external spec
root. Sibling spec dirs created concurrently by other plans are ignored, so
multiple `commit:false` plans for the same project run in parallel without false
boundary violations. A plan that genuinely writes outside its own spec dir still
trips the violation.

## Out of scope

- The `commit:true` path (spec dirs are in-repo on per-plan worktrees; no shared
  external root).

## Prerequisites
