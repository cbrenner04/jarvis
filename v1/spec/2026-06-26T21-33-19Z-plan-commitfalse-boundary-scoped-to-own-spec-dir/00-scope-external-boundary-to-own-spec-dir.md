# Scope no-commit external boundary to own spec dir

## Problem

Concurrent `jarvis1 plan` runs for one `commit:false` project trip a spurious
`boundary violation detected before draft commit`. The pre-draft external check
(`assertNoCommitExternalSpecBoundary`) snapshots the whole shared external spec
root (`~/.jarvis/specs/<proj>/`) at run start, then flags every top-level entry
created after the snapshot. Sibling spec dirs that other concurrent plans create
mid-run are flagged as out-of-bounds writes, so all but the last-started plan
block. Each plan has its own external spec dir under the shared root, but they
all run against the *same live checkout* (`project.root`) — `commit:false` does
not use a per-plan worktree. The isolation that makes concurrency safe is the
separate external spec dir, not a worktree.

A rogue sibling (a stray write into the external root by one plan) and a
concurrent legitimate sibling (another plan's spec dir) are byte-identical
signals at the external root: both are just new top-level entries. The check
cannot distinguish them without per-write attribution, which is the root cause
of the false positive.

The genuine in-checkout guard exists separately: the worktree/repo boundary
(`assertTargetRepoPlanBoundary` for git roots, `assertPlanWriteBoundary` for
commit mode) flags `spec/`-prefixed writes into the live checkout. It never
inspects external storage.

## Decisions

- Drop the shared external-root sibling enumeration: the no-commit external
  boundary no longer flags sibling top-level entries. Rules out keeping the
  run-start snapshot + diff, which races with concurrent sibling-dir creation.
- External-storage rogue-sibling detection is *removed*, not relocated — this is
  an accepted coverage loss, not a preservation. After removal nothing inspects
  `~/.jarvis/specs/<proj>/`, so a `commit:false` plan that writes a stray sibling
  into external storage is caught by nothing. No concurrency-safe replacement
  exists: a rogue sibling and a legitimate concurrent sibling are byte-identical
  at the external root without per-write attribution. Severity is low — the blast
  radius is Jarvis-owned scratch storage, never the user's target repo. Rules out
  adding a new external-storage diff mechanism to replace the enumeration.
- Genuine in-checkout writes are still caught by the existing worktree/repo
  boundary check, left unchanged. That guard flags only `spec/`-prefixed paths in
  the target checkout; it does not cover arbitrary out-of-dir writes or external
  storage. Rules out claiming the surviving check fully replaces the removed one.
- Scope removal to the `preExistingSiblings` snapshot and
  `assertNoCommitExternalSpecBoundary` only. Keep `externalSpecRoot`, which stays
  load-bearing (dir creation, collision detection, preserved-spec breadcrumb).
  Rules out an over-eager removal of `externalSpecRoot` along with the snapshot.
- Change only the no-commit draft/review branch call site; leave the
  `commit:true` `assertPlanWriteBoundary` call site untouched. Rules out
  collateral edits to the commit-mode boundary.

## Task checklist

- [ ] Remove the shared-root sibling enumeration so concurrent no-commit plans
      no longer flag each other's spec dirs.
- [ ] Remove `preExistingSiblings` snapshot capture/plumbing from the draft
      (`run.ts`) and review (`review.ts`) boundary call sites.
- [ ] Drop the `assertNoCommitExternalSpecBoundary` unit tests covering sibling
      enumeration (coverage dropped, not replaced).
- [ ] Update docs: `v1/docs/plan-mode.md` write-boundary section and
      `v2/docs/v1-behaviors.md` boundary entry.

## Acceptance criteria

- [x] A no-commit plan run whose external spec root gains a sibling spec
      directory created after the run started no longer trips `plan: boundary
      violation detected before draft commit`; the run proceeds past the
      pre-draft boundary check.
- [x] Two concurrent `commit:false` plans for the same project both complete
      without a spurious boundary violation (neither blocks on the other's
      sibling spec dir).
- [x] A `commit:false` plan that writes a `spec/`-prefixed path into the target
      checkout outside its own spec dir still trips the boundary violation: the
      `assertTargetRepoPlanBoundary` tests in
      `v1/test/modes/plan/boundary.sandbox-unrunnable.test.ts` stay green
      (surviving in-checkout guard unchanged; it does not catch non-`spec/`
      writes or external-storage escapes — those are no longer guarded).
- [x] `assertPlanWriteBoundary` tests in the same file stay green (commit-mode
      boundary unchanged).
- [x] No `preExistingSiblings` snapshot is captured or passed at the draft or
      review boundary call sites in `v1/src/modes/plan/run.ts` and
      `v1/src/modes/plan/review.ts`.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: rewrite the `commit: false` paragraph in `## Write
  boundary` (currently "run-scoped … flags only entries created during this
  run"). State that the external spec root is no longer inspected at all, and
  explain *why* concurrent no-commit plans now coexist: coexistence holds
  precisely because the external check no longer enumerates siblings. Note that
  the surviving worktree/repo boundary guards only `spec/`-prefixed writes into
  the target checkout and does not cover external storage, so a stray write into
  external storage is no longer detected.
- `v2/docs/v1-behaviors.md`: update the plan write-boundary entry (the "no-commit
  external spec-root check is run-scoped … flags only entries created during this
  run" sentence). Record the new behavior as the v1 parity baseline: the external
  spec-root check is removed, including the dropped rogue-sibling detection — no
  external-storage check remains.
