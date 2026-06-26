# Scope no-commit external boundary to own spec dir

## Problem

Concurrent `jarvis1 plan` runs for one `commit:false` project trip a spurious
`boundary violation detected before draft commit`. The pre-draft external check
(`assertNoCommitExternalSpecBoundary`) snapshots the whole shared external spec
root (`~/.jarvis/specs/<proj>/`) at run start, then flags every top-level entry
created after the snapshot. Sibling spec dirs that other concurrent plans create
mid-run are flagged as out-of-bounds writes, so all but the last-started plan
block — even though each has an isolated worktree and an independent spec dir.

The genuine out-of-own-dir guard already exists separately: the worktree/repo
boundary (`assertTargetRepoPlanBoundary` for git roots, `assertPlanWriteBoundary`
for commit mode) flags writes into the live checkout. Only the shared-root
sibling enumeration is concurrency-unsafe.

## Decisions

- Drop the shared external-root sibling enumeration: the no-commit external
  boundary no longer flags sibling top-level entries. Rules out keeping the
  run-start snapshot + diff, which races with concurrent sibling-dir creation.
- Genuine out-of-own-dir writes are still caught by the existing worktree/repo
  boundary check, left unchanged. Rules out adding a new external-storage diff
  mechanism to replace the enumeration.
- Remove `assertNoCommitExternalSpecBoundary` and the `preExistingSiblings`
  snapshot plumbing in `run.ts` and `review.ts` rather than neuter in place.
  Rules out leaving dead snapshot code implying a boundary it no longer enforces.
- `commit:true` path untouched (in-repo spec dirs on per-plan worktrees; no
  shared external root).

## Task checklist

- [ ] Remove the shared-root sibling enumeration so concurrent no-commit plans
      no longer flag each other's spec dirs.
- [ ] Remove `preExistingSiblings` snapshot capture/plumbing from the draft
      (`run.ts`) and review (`review.ts`) boundary call sites.
- [ ] Drop/replace the `assertNoCommitExternalSpecBoundary` unit tests covering
      sibling enumeration.
- [ ] Update docs: `v1/docs/plan-mode.md` write-boundary section and
      `v2/docs/v1-behaviors.md` boundary entry.

## Acceptance criteria

- [ ] A no-commit plan run whose external spec root gains a sibling spec
      directory created after the run started no longer trips `plan: boundary
      violation detected before draft commit`; the run proceeds past the
      pre-draft boundary check.
- [ ] Two concurrent `commit:false` plans for the same project both complete
      without a spurious boundary violation (neither blocks on the other's
      sibling spec dir).
- [ ] A `commit:false` plan that writes into the worktree/repo checkout outside
      its own spec dir still trips the boundary violation: the
      `assertTargetRepoPlanBoundary` tests in
      `v1/test/modes/plan/boundary.sandbox-unrunnable.test.ts` stay green
      (genuine out-of-own-dir guard unchanged).
- [ ] `assertPlanWriteBoundary` tests in the same file stay green (commit-mode
      boundary unchanged).
- [ ] No `preExistingSiblings` snapshot is captured or passed at the draft or
      review boundary call sites in `v1/src/modes/plan/run.ts` and
      `v1/src/modes/plan/review.ts`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: rewrite the `commit: false` paragraph in `## Write
  boundary` (currently "run-scoped … flags only entries created during this
  run") to state that sibling spec dirs at the external root are ignored so
  concurrent no-commit plans coexist, and that out-of-own-dir writes are caught
  by the worktree/repo boundary.
- `v2/docs/v1-behaviors.md`: update the plan write-boundary entry (the
  "no-commit external spec-root check is run-scoped … flags only entries created
  during this run" sentence) to reflect that the external check no longer
  enumerates siblings; record the new behavior as the v1 parity baseline.
