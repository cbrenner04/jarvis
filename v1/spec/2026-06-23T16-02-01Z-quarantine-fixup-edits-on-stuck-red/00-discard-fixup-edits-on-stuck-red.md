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

- Green-completion baseline = the PR branch HEAD captured the first time the completion gate goes red (i.e. before the first fix-up iteration runs); rules out resetting to the PR base merge-base, which would discard the correct spec work too.
- Discard = `git reset --hard <baseline>` plus a force-push of the branch; local reset alone is rejected because the fix-up commits were already pushed, so the remote PR would still show the chase edits.
- Discard fires at both exit-10 sites (identical-failure stop and changing-failure bound) — both terminate still-red with the same contamination.
- Discarding is sound because both stop conditions already guarantee no acceptance-criteria progress and no new blocker during the fix-up iterations, so nothing the operator wants is reset away.
- Guard discard on `gitEnabled`, a captured baseline, and the baseline differing from HEAD; skip the force-push when no PR/remote branch exists rather than erroring — keeps no-git and PR-less runs working.
- Force-push uses lease-style safety where available; a failed force-push is logged as a warning and does not change the exit-10 outcome.
- Extend the two existing stuck-red operator messages rather than adding a third terminal path: each now states the chase edits were discarded and the PR is left at the original completed work, and names the flaky-or-real ambiguity (gate red after N tries, finalize by hand). Exit code (10) and telemetry (`ready-stuck-red`) are unchanged.

## Task checklist

- [ ] Capture the green-completion baseline SHA on first red gate, before the first fix-up loopback.
- [ ] At both exit-10 sites, reset the branch to the baseline and force-push before returning 10.
- [ ] Update both stuck-red messages to state the discard and name the ambiguity.
- [ ] Update tests and docs.

## Acceptance criteria

- [ ] On an identical-failure stuck-red stop, the commits added by fix-up iterations after the spec completed are discarded and the PR branch is force-pushed, so the remote PR no longer contains the chase edits — its diff matches the completed spec work as it stood before the first fix-up iteration.
- [ ] On a changing-failure-bound stuck-red stop, the same discard and force-push occur.
- [ ] When the completion gate goes green (no fix-up, or fix-up converges), no discard or force-push occurs and the existing completion path is unchanged: `run.test.ts` completion-green/draft-PR tests stay green.
- [ ] The stuck-red stop still exits `10` and writes a `ready-stuck-red` telemetry record at both sites (behavior unchanged): the exit-code and telemetry assertions in `run.test.ts` stuck-red tests stay green.
- [ ] Both stuck-red operator messages name the flaky-or-real ambiguity (gate red after N tries, finalize by hand) and state that the fix-up edits were discarded and the PR is left with the original correct work; the identical-failure and changing-failure messages remain distinct from each other and from a normal completion.
- [ ] When git is disabled, or no fix-up commits exist beyond the baseline, the stop still exits `10` with no force-push attempted and no error raised.

## Documentation updates

- [ ] `v1/docs/run-loop.md` — Stuck-red completion stop (exit 10) section: document that both stop variants discard the fix-up commits (reset to the green-completion baseline) and force-push, leaving the PR at the original work, and update the message descriptions.
- [ ] `v2/docs/v1-behaviors.md` — Patch-mode stuck-red completion stop entries: record the new discard + force-push behavior and the updated messages as the v1 parity baseline.
- [ ] `v1/docs/operator-runbook.md` — note that a stuck-red PR is left at the original completed work (chase edits already discarded), so finalize-by-hand starts from a clean diff.
