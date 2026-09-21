# Run-row-free archival for in-repo stranded artifacts

## Problem

`inspectStrandedArtifacts` (`v2/src/commands/cleanup.ts`) resolves a durable branch by matching `store.listRuns()` against the artifact's spec source, and skips with `no durable implementation branch` when none matches. A spec authored and implemented by hand never produced a run row, so cleanup skips it on every pass even after the work merged, and the operator archives it by hand with `git mv`.

## Decisions

- Widen eligibility only when `recordedStrandedBranch` returns undefined and the artifact is in-repository (not an external plan tree, no `queue`) with its source under the registered project's primary checkout — external plan trees have no primary-checkout source, so they keep the run-row requirement.
- A run row that exists but resolves no branch is skipped — a **behavior change**, not preserved behavior: before this spec, `recordedStrandedBranch` returned `""` for such a row, so the artifact reached `checkArtifactEligibility` with `findOpenPrs("")` and came back eligible, archiving on a meaningless `gh` call. This spec fixes that latent bug by skipping the empty-branch row explicitly; the widening triggers on *no matching run row*, not on an empty branch — rules out treating a branchless row as hand-landed.
- Completeness evidence is the spec tree **as committed on the repository default branch** (resolved by the existing `getBaseBranch`, read with `git ls-tree`/`git show`): its `index.md`'s linked subspecs must have no unchecked non-human-only acceptance criteria, reusing `completedSpecEligibility` over that committed content; index routing checkboxes are ignored. Ticks reach the default branch only through a merged PR, so the evidence is "someone merged a PR asserting this is done", never "someone edited a checkbox locally" — rules out both reading the index checklist as completion and trusting working-tree state (uncommitted ticks, or a checkout parked on a feature branch).
- No-owner evidence is that no materialized worktree in any registered project contains the artifact's source path (checkout-relative path present on disk under the worktree) — rules out relying on branch-keyed ownership, which has no branch to key on here.
- Fail closed: a spec tree absent from, or unreadable on, the default branch is not archivable, and any inspection error declines — rules out archiving on inconclusive evidence.
- The decision carries its reason rather than a bare boolean, so the skip line names the real cause (`unchecked acceptance criterion in 00-foo.md: …`, `spec is not committed on <branch>`) instead of the generic `no durable implementation branch` — rules out reporting a misleading cause.
- Archive the widened artifact through the same stranded path (`archiveArtifactSpec`, cleanup archive branch, preview and apply reporting), so it reports like any other stranded artifact — rules out a separate hand-landed report channel.
- Skip the open-PR check for these artifacts: there is no branch to query — rules out querying `gh` with an empty ref.

## Task checklist

- [ ] Extract a pure predicate that decides run-row-free eligibility from (artifact, projectRoot, worktrees) so both directions test without a daemon.
- [ ] Wire it into the `branch === undefined` arm of `inspectStrandedArtifacts`, preserving the skip reason when it declines.
- [ ] Tests covering: hand-landed complete spec archives; unchecked non-human-only criterion still skips; worktree containing the source still skips; external plan tree still skips.
- [ ] Docs.

## Acceptance criteria

- [x] `jarvis cleanup` archives an in-repo stranded spec that has no matching run row when its default-branch `index.md` links only subspecs whose non-human-only acceptance criteria are all checked and no materialized worktree contains its source path.
- [x] An in-repo stranded spec with no matching run row and an unchecked non-human-only acceptance criterion in a linked subspec is still skipped.
- [x] An in-repo stranded spec with no matching run row whose source path exists inside a materialized worktree of any registered project is still skipped.
- [x] An external plan tree with no matching run row is still skipped with `no durable implementation branch`.
- [x] An artifact whose run row exists but resolves no branch is skipped (a behavior change: it previously archived after a `findOpenPrs("")` query).
- [x] An in-repo stranded spec with no matching run row whose acceptance-criteria ticks exist only in the working tree — unticked on the default branch — is not archived.
- [x] An in-repo stranded spec with no matching run row whose spec tree is absent from the default branch is not archived.
- [x] A hand-landed skip names its real cause (the unchecked-criterion or not-committed reason), not the generic `no durable implementation branch`.
- [x] Preview and apply report the widened archive with the same `stranded artifact` wording as any other stranded archive.
- [x] A new test in `v2/src/commands/cleanup.test.ts` drives a hand-landed in-repo spec (no run row, complete subspecs, no owning worktree) to an archive and fails against the pre-fix code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` — § Cleanup: hand-landed specs archive without a run row, and what evidence cleanup requires.
- [ ] `v2/docs/v1-behaviors.md` — record the widened stranded-artifact eligibility.
