---
name: stale-reset-destroys-commits-for-external-specs
---

# Stale-workspace retirement deletes a branch carrying completed subspec commits when the spec tree is external

## Problem

On an incomplete `implement` re-dispatch, preflight gate 2 ("preserve landed criteria") is the only gate that can see that the branch about to be retired carries work the spec tree already records as done. It is skipped whenever the spec path resolves outside the project root — `isStaleResetLandedCriteriaSpecPath` (`v2/src/commands/cleanup.ts:2312`) returns `false` for any out-of-root path, which is every `plan.commit: false` / external-spec-home project and every chained fan-out lane.

Gate 1 (descendant) does not cover the case: a branch with real commits ahead of base *is* a descendant of base, so it passes. Retirement then deletes the worktree, the local branch, and the remote branch, and the re-dispatched run starts from an empty tree while the external spec tree still shows those subspecs `[x]`. The two sources of truth disagree in the dangerous direction — the plan says done, the code is gone — and later subspecs get built on foundations that no longer exist.

The operator signal is one `Deleted local branch: <name>` line. No incident, no confirmation, no tip SHA.

## Evidence

Issue #3433 (jarvis `9096b1a87`, project `homestead-service`, `plan.commit: false`, 9-subspec external tree). Subspecs 00 (recurrence configuration contract) and 01 (application timezone seam) committed and were ticked; subspec 02 died `invocation_error` / `resumable: false`. Re-dispatching the same `implement --base main --spec <index.md>` printed `Deleted local branch: recurrence-engine` and produced a worktree with zero commits and no `src/recurrence-engine/`, while the index still read `[x]` for 00 and 01. Two subspecs of load-bearing work lost; recovered only because the operator checked by hand.

Confirmed still live on `main` 2026-09-12 by reading the gate: the out-of-root early return at `cleanup.ts:2320` predates and is independent of the external-plan-implement work.

## Decisions

- The landed-criteria gate reads the spec tree **where the run actually reads it** (external spec home, prior-stage worktree, or project root), not only at a project-root-relative path; an out-of-root tree is compared at its own location rather than skipped. Rules out "external means unguarded".
- When the comparison genuinely cannot run, retirement refuses rather than proceeding — inconclusive is not permissive for a destructive step. Rules out the current silent fall-through.
- Any retirement that deletes a branch reachable commits records the retired tip SHA in the `Retirement destroyed artifacts:` block, so recovery is `git branch <name> <sha>` and not an object-store hunt. Rules out recovery-by-`fsck`.
- Scope is the stale-reset preflight gate. No change to gate 1, gate 3, `--reset-despite-landed-criteria`, or `cleanup --abandon`. Rules out widening into retirement ordering, which is [[implement-retirement-destroys-artifacts-before-materialization]].

## Acceptance criteria

- [ ] A test drives stale-reset preflight with a spec tree outside the project root whose subspec has a non-human-only criterion ticked in the worktree tree and unticked on base, and proves retirement is refused naming that subspec path; it fails against the current out-of-root early return.
- [ ] A test proves an in-root spec tree keeps its existing gate behaviour, and that `--reset-despite-landed-criteria` still skips only this gate, for both in-root and out-of-root trees.
- [ ] A test proves a spec tree that cannot be compared (unreadable at its resolved location) refuses retirement with a named reason rather than proceeding.
- [ ] A test proves a retirement that deleted a branch with commits ahead of base reports that branch's tip SHA in its destroyed-artifacts output.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Incomplete re-run preflight gates: gate 2 applies to external and prior-stage spec trees; destroyed-artifacts output names the retired tip SHA.
- `v2/docs/workflow-runner.md` — external plan implement admission: the landed-criteria comparison is no longer skipped for the external path.
