---
name: gate-autofix-can-turn-a-green-tree-red
---

# `bun run fix` rewrites `findIndex` into `indexOf` and breaks `typecheck`

## Problem

The ready gate runs project autofix once per repair entry before any repair agent. On current
`main`, that autofix makes the repo **stop typechecking**:

```sh
git checkout main && bun run fix     # Fixed 2 files
bun run typecheck
# v2/src/tui/tui-monitor-lines.ts(376,50): error TS2345:
#   Argument of type '… | undefined' is not assignable to parameter of type 'MonitorPipelineTreeDisplayNode'
```

The lint rule rewrites `fullTreeRows.findIndex((entry) => entry === treeRow)` to
`fullTreeRows.indexOf(treeRow)`. `treeRow` is `T | undefined`; the callback form accepted that,
`indexOf` does not. The same rewrite lands in `v2/src/execution/mutation-checkpoint-verifier.ts`
(there it happens to stay well-typed).

Observed 2026-08-02 on `20260802T042601Z-tui-selection-detail-pane`: run `bc349efa` finished its
write step, autofix rewrote the line, the run settled `completion_commit_failed` with the autofix
edits **uncommitted** on disk, and `jarvis run resume` then settled `ready_gate_failed` on the red
typecheck. It only landed after the operator hand-edited the line and resumed a second time. The
gate cannot repair this class: every repair entry re-runs autofix, which re-applies the same break.

Two defects, and the second is the general one:

1. This particular rewrite is unsafe for a possibly-`undefined` needle.
2. Autofix output is committed (or left on disk) without being re-verified, so a green tree can be
   turned red by the gate's own repair step.

## Decisions

- Autofix runs `typecheck` on its own output before the fence commit; when autofix makes typecheck
  fail, its edits are reverted and the gate proceeds to repair on the pre-autofix tree, logging
  what was discarded — rules out a repair step that can only make things worse, and rules out
  relying on the repair agent to undo the harness's own edit.
- Disable or scope the offending lint rule so `bun run fix` does not produce the unsafe rewrite;
  keep the type-safe call sites as they are — rules out leaving a known-red autofix armed while
  the guard above is the only thing catching it.
- Out of scope: the wider repair-iteration budget, `ready_gate_out_of_scope` classification, and
  the uncommitted-autofix-edits path into `completion_commit_failed` (recorded here as evidence,
  not fixed).

## Acceptance criteria

- [ ] `bun run fix` on a clean checkout leaves `bun run typecheck` green; a test pins the specific
      unsafe rewrite (possibly-`undefined` needle) as not applied.
- [ ] When autofix produces a tree that fails `typecheck`, the gate reverts the autofix edits,
      records the discard with the failing output, and enters repair against the pre-autofix tree
      instead of committing the broken edits.
- [ ] A run whose autofix output typechecks is unaffected: the fence commit, republish, and re-gate
      path is unchanged; a regression covers it.
- [ ] Mutation checkpoint: removing the post-autofix typecheck verification turns the revert test
      RED, via a `// @mutate` directive in the pinning file.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — autofix is verified before it is committed, and what
  the discard log looks like.

## Prerequisites

- The ready-gate autofix entry (`fixCommand` / built-in `bun run fix`, fence-validated commit,
  republish, re-gate)
- `biome.json` (or equivalent) rule configuration behind `bun run fix`
