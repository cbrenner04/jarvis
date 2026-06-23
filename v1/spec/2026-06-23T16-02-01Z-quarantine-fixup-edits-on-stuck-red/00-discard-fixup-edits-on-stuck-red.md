# Discard fix-up commits on stuck-red stop

## Problem

When the completion-ready fix-up loop terminates still-red at its bound (exit 10,
`ready-stuck-red`), the commits the fix-up iterations added are left on the PR.
Those edits chase a possibly-flaky failure and contaminate the diff; observed in
groceries #14, where correct spec work had to be salvaged by hand from the chase
edits.

Both exit-10 sites are in `tryFinishSpecIfDone` /
`v1/src/modes/patch/completion-pipeline.ts`: the identical-failure stop
(currently returns 10 at the `isStuckRed` branch) and the changing-failure bound
(`CONSECUTIVE_RED_FIXUP_BOUND`). Each currently leaves the worktree and pushed PR
branch carrying every fix-up commit.

## Decisions

- First-red baseline = the PR branch HEAD at the first red completion gate, captured before the first fix-up loopback; held in a new `ctx.state` field (e.g. `firstRedBaselineSha`) parallel to `consecutiveRedFixups` / `completionTransitionReadyResult`, written once on first red and never overwritten. Rules out a "green result sha" — on a stuck-red run the gate never goes green, so no green-path sha is ever recorded. Capture is guarded by `gitEnabled` + a real `.git` present, the same guards the green-path `completionTransitionReadyResult` capture uses.
- Resetting to the first-red baseline (not the PR base merge-base) is what preserves the correct spec work: merge-base reset would discard it too.
- Discard = `git reset --hard <baseline>` plus a force-push; local reset alone is rejected because the fix-up commits were already pushed, so the remote PR would still show the chase edits.
- Force-push command is `git push --force-with-lease` (the local reset leaves the remote-tracking ref intact, so the lease holds). Rules out a bare `git push --force`.
- Discard reuses the existing fix-up push seam: the `hasUpstream(cwd)` upstream-existence check and the `skipGhCheck` flag (see `iteration.ts`). When there is no upstream / `skipGhCheck` is set, skip the force-push rather than erroring — keeps no-git and PR-less runs working.
- Discard fires at both exit-10 sites (identical-failure stop and changing-failure bound) — both terminate still-red with the same contamination.
- Discarding is sound by mechanism, not by a "no progress in last N iterations" argument: fix-up iterations run with **no active linked subspec**, so they cannot commit an acceptance-criteria tick or re-tick. A blocker exits 7 (and stuck-red requires no new blocker), so the only commits a fix-up iteration produces are discardable chase edits — nothing the operator wants is reset away.
- Discarded tip preservation: rely on git reflog only; do not create a recovery tag/branch. The reset commit stays reachable via reflog in the worktree, and the operator message names where the chase edits went. Rules out a named recovery ref as unneeded ceremony for a single-operator harness.
- Order of operations at each exit-10 site: reset → force-push → operator message → telemetry → return 10. A thrown reset or a failed force-push is caught and logged as a warning; telemetry (`ready-stuck-red`) is still written and the site still returns 10. The exit code and telemetry contract is invariant under git failure.
- Extend the two existing stuck-red operator messages rather than adding a third terminal path: each now states the chase edits were discarded (recoverable via reflog) and the PR is left at the original completed work, and names the flaky-or-real ambiguity (gate red after N tries, finalize by hand). Identical-failure and changing-failure messages stay distinct from each other and from normal completion.

## Task checklist

- [ ] Add the `firstRedBaselineSha` run-state field; capture HEAD into it on the first red completion gate, before the first fix-up loopback, guarded by `gitEnabled` + `.git` present.
- [ ] Add a discard step (reset → `git push --force-with-lease` via the `hasUpstream` / `skipGhCheck` seam) and call it at both exit-10 sites in the order above, before returning 10.
- [ ] Update both stuck-red messages to state the discard, name reflog recovery, and name the ambiguity.
- [ ] Update tests and docs.

## Acceptance criteria

- [x] On an identical-failure stuck-red stop, the commits added by fix-up iterations after the spec completed are discarded (reset to the first-red baseline) and the PR branch is force-pushed with `--force-with-lease`, so the remote PR no longer contains the chase edits — its diff matches the completed spec work as it stood before the first fix-up iteration.
- [x] On a changing-failure-bound stuck-red stop, the same discard and force-push occur.
- [x] When the completion gate goes green (no fix-up, or fix-up converges), no discard or force-push occurs and the existing completion path is unchanged: `run.test.ts` completion-green/draft-PR tests stay green.
- [x] The stuck-red stop still exits `10` and writes a `ready-stuck-red` telemetry record at both sites (behavior unchanged): the exit-code and telemetry assertions in `run.test.ts` stuck-red tests stay green.
- [x] A failed force-push (or a thrown reset) at a stuck-red stop is logged as a warning, but telemetry (`ready-stuck-red`) is still written and the site still exits `10` — the exit/telemetry contract holds under git failure.
- [x] Both stuck-red operator messages name the flaky-or-real ambiguity (gate red after N tries, finalize by hand), state that the fix-up edits were discarded (recoverable via git reflog), and that the PR is left with the original correct work; the identical-failure and changing-failure messages remain distinct from each other and from a normal completion.
- [x] When git is disabled, no upstream exists (`hasUpstream` false / `skipGhCheck` set), or no fix-up commits exist beyond the baseline, the stop still exits `10` with no force-push attempted and no error raised.

## Documentation updates

- [x] `v1/docs/run-loop.md` — Stuck-red completion stop (exit 10) section: document that both stop variants discard the fix-up commits (reset to the first-red baseline) and force-push with `--force-with-lease`, leaving the PR at the original work; that a failed git step still exits 10 with telemetry; and update the message descriptions.
- [x] `v2/docs/v1-behaviors.md` — Patch-mode stuck-red completion stop entries: record the new discard + force-push behavior and the updated messages as the v1 parity baseline.
- [x] `v1/docs/operator-runbook.md` — note that a stuck-red PR is left at the original completed work (chase edits discarded, recoverable via git reflog), so finalize-by-hand starts from a clean diff.
