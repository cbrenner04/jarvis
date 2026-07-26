# `jarvis cleanup` must be run twice to archive a spec, because it scans before it retires

## Problem

A completed spec is not archived by the cleanup invocation that retires its worktree. The operator
runs `jarvis cleanup`, watches it retire the worktree, and the spec stays in the open home; a second
invocation archives it. That second run does no new work — it only re-observes state the first run
created.

The cause is ordering inside a single invocation (`v2/src/commands/cleanup.ts`, `runCleanupCommand`):

```text
582  discovered = await discoverMaterializedWorktrees(...)
583  candidates = await findEligibleWorktreeCandidates(discovered, ...)
591  stranded   = await inspectStrandedArtifacts(discoverStrandedArtifacts(registry),
                                                 registry, discovered, ...)   <-- scan
628  result     = await retireEligibleWorktrees(stillEligible, ..., discovered, ...)  <-- retire
633  await retireStrandedArtifacts(stranded, ...)                              <-- archive
```

`inspectStrandedArtifacts` runs at line 591 against `discovered`, the worktree list captured **before
any retirement**. A spec whose worktree is retired later in the same invocation (line 628) is
therefore evaluated while that worktree is still materialized, fails the "another materialized owner"
ownership check, and is excluded from `stranded`. Line 633 then archives only the set computed from
stale state.

The archival that `archiveRetiredArtifact` performs inside `retireEligibleWorktrees` covers artifacts
it can resolve from the retiring worktree's durable identity; anything that falls to the open-home
stranded path instead is subject to the ordering above.

`v2/docs/operator-runbook.md` § Cleanup states the opposite — "archives an eligible completed artifact
to `completed/` in the same cleanup invocation; this path needs no rerun" — so the docs and the
behavior disagree.

Cost is small per occurrence but it is every session, it is pure operator toil, and it makes
`--dry-run` misleading: the preview is computed from the same pre-retirement snapshot, so it lists
candidates that the apply pass will refuse.

## Decisions

- Compute the stranded/open-home artifact set **after** worktree retirement within the same
  invocation, so ownership is evaluated against post-retirement state; rules out requiring a second
  invocation to observe what the first one just did.
- Re-derive (or invalidate) the materialized-worktree list after retirement rather than reusing the
  `discovered` snapshot captured at line 582; rules out passing a stale list into the ownership check.
- Preserve every existing refusal on its own terms: unchecked criteria, an open matching PR, and a
  genuinely still-materialized owner (one this invocation did not retire) must still refuse. Rules out
  buying same-invocation archival by weakening the ownership gate.
- `--dry-run` must preview the same set the apply pass would archive; if that cannot be known without
  retiring, it must say so rather than list candidates it will later refuse.
- Out of scope: the archival eligibility rules themselves, and dead-socket reaping.

## Acceptance criteria

- [ ] One `jarvis cleanup` invocation that retires a worktree also archives that spec to `completed/`;
      a regression drives retire-plus-archive in a single invocation and fails against the pre-fix
      ordering (which leaves the spec in the open home).
- [ ] A second immediate invocation reports nothing to clean, proving the first was complete.
- [ ] A spec whose owning worktree is **not** retired by this invocation is still refused, and the
      refusal names the materialized owner; inverting that guard fails a test.
- [ ] Specs with unchecked criteria or an open matching PR are still refused with their existing
      reasons.
- [ ] `--dry-run` output matches what the subsequent apply pass archives for the same state.
- [ ] `v2/docs/operator-runbook.md` § Cleanup describes the actual single-invocation guarantee.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — same-invocation archival, and what
  `--dry-run` can and cannot predict.
