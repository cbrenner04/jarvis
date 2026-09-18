---
name: stale-reset-destroys-commits-for-external-specs
---

# The landed-criteria preflight gate is blind to external spec trees

## Problem

On an incomplete `implement` re-dispatch, preflight gate 2 ("preserve landed criteria") compares the worktree's spec tree against base to refuse retiring a branch whose work the tree already records as done. It is skipped for any spec path outside the project root: `isStaleResetLandedCriteriaSpecPath` (`v2/src/commands/cleanup.ts`, ~:2668) returns `false` out-of-root, and external trees resolve `trackableSpecPath: undefined`. That is every external-spec-home project (`specs: "external"`, the default) and every chained fan-out lane.

Issue #3433 was the destructive shape: two committed, ticked subspecs deleted with the branch while the external index still read `[x]`. #4014 closed that path — a committed descendant lane now continues instead of retiring, and a non-descendant refuses naming the tip SHA — so the branch is no longer deleted. What remains is that gate 2 still cannot see an external tree, so tick-without-commit drift on an external project is never refused, and the `Retirement destroyed artifacts:` block (`workflow.ts`) still omits the retired tip SHA on the paths that do destroy.

## Decisions

- The landed-criteria gate reads the spec tree where the run actually reads it (external home, prior-stage worktree, or project root); an out-of-root tree is compared at its own location rather than skipped. Rules out "external means unguarded".
- When the comparison cannot run, retirement refuses; inconclusive is not permissive for a destructive step.
- Any retirement that deletes a branch with reachable commits records the tip SHA in the destroyed-artifacts block. Rules out recovery-by-`fsck`.
- Scope is gate 2 and the destroyed-artifacts output. No change to gate 1, gate 3, continuation (#4014), `--reset-despite-landed-criteria`, or `cleanup --abandon`.

## Acceptance criteria

- [ ] A test drives stale-reset preflight with a spec tree outside the project root whose subspec is ticked in the worktree tree and unticked on base with no matching commit, and proves retirement is refused naming that subspec; it fails against the current out-of-root early return.
- [ ] A test proves an in-root tree keeps its existing behaviour and `--reset-despite-landed-criteria` still skips only this gate, in-root and out-of-root.
- [ ] A test proves an unreadable spec tree refuses retirement with a named reason.
- [ ] A test proves a retirement that deleted a branch with commits ahead of base reports that branch's tip SHA in its destroyed-artifacts output.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Incomplete re-run preflight gates: gate 2 applies to external and prior-stage trees; destroyed-artifacts output names the tip SHA.
- `v2/docs/workflow-runner.md` — external plan implement admission no longer skips the landed-criteria comparison.
