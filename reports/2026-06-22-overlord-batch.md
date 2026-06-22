# Overlord session — 2026-06-22 (intent batch)

Jarvis-on-Jarvis overlord run: drove the wip-intent queue through plan→run→merge, reviewed every PR, admin-merged on a green gate. Continuation of the prior overlord session (post-compaction).

## Shipped (8 PRs merged, 7 intents)

| Intent | PRs | Effect |
| --- | --- | --- |
| correct-agent-default-models | #396 | codex→gpt-5.4, cursor→Composer 2.5 defaults |
| agent-transient-retry-backoff | #397/#398 | escalating `[1s,2s,4s]` backoff, cap 2→3, abort-racing async sleep seam |
| flaky-serial-retry-agent-mid-work-runs | #399/#400 | serial-retry on base-ref + snapshot runners; patch-rules doc-only-skip + serial-retry guidance |
| intent-split-emit-contract-flaky | #401/#402 | deterministic emit-contract repair (name-from-slug, empty Prerequisites) |
| intent-pr-auto-ready | #403/#404 | intent PRs auto-ready like plan PRs |
| harness-suggestion-intake | #405/#406 | `.github/ISSUE_TEMPLATE/harness-suggestion.md` + runbook submit/triage |
| finalize-complete-but-dirty-run | #390 | idle watchdog default-on across patch+plan phases; complete-but-dirty auto-commit |

## #390 — hand-debugged (operator recovery, authorized)

Parked mid-session (review-actuator idle-watchdog test red); a haiku fix-up only reformatted it. Root-caused two bugs:
1. **Production:** idle abort threw `ReviewTerminalError(-1)`, propagating past the `idleTimeoutOccurred → return 8` return-path check; and the actuator wrote telemetry via `opts.writeTelemetry` (not the `trackingWriteTelemetry` wrapper that sets the flag). Fix: set the flag in the actuator's idle branch + honor it in the catch.
2. **Test fixture:** hang script lived untracked inside the repo → review's reviewer-edit revert (`git clean -fd`) removed it before the actuator spawned (ENOENT). Moved outside the repo tree.

Merged main (one `v1-behaviors.md` conflict, kept both serial-retry + complete-but-dirty lines), full suite 1407 pass, admin-merged.

## Workflow / tooling / harness observations

- **No idle watchdog on the running harness was the dominant pain.** Three separate ~23-min review-actuator stalls (finalize, flaky-serial, intent-pr-auto-ready runs) were each killed only by the blunt 30-min iteration timeout. #390 now fixes this for future runs — it was the highest-leverage merge. A background stall-watcher (poll agent-child CPU; flag 0.0% sustained) was essential to catch stalls the harness couldn't surface.
- **Haiku is below a usable actuator floor.** Beyond stalls: it weakened correct code (`match[1]!.trim()` → `?.` regression), made out-of-scope spec edits (reverted by the harness), and couldn't engage the #390 bug. Direct evidence for the static-per-phase-floor decision (actuator floored above haiku). → [[deterministic-model-tiering-policy]] / [[actuator-role-model-floor]].
- **`check:fix:unsafe` vs `noUncheckedIndexedAccess` landmine.** The ready gate's biome unsafe-autofix rewrites `arr[i]!.x` → `arr[i]?.x`, which then fails typecheck — an unfinalizable gate state that's invisible in CI (CI only `check`s). Hit on intent-split; fixed in-place + filed [[check-fix-unsafe-rewrites-nonnull-assertions]].
- **CI rollup lag on actuator/merge commits.** `gh pr view` statusCheckRollup often showed empty/stale for the PR head while `gh run list` showed the real run; and some head commits never triggered CI. Verified green via `gh run list --branch` matched to head SHA, and by running the gate locally when needed.
- **Spec quality was consistently high.** Plan-mode (opus) produced atomic, well-grounded specs with explicit "rules out" rationale; review passes mostly made no changes. The grounding caught real subtleties (async vs sync sleep seam, coverage-based not extension-based doc-only-skip, label-prerequisite sequencing).
- **Recurring git hygiene:** `gh pr merge --delete-branch` fails to delete the local branch while its worktree exists — harmless (remote deleted), cleaned up with explicit `git worktree remove` after.

## Cost (2026-06-22 day total, all runs)

~$59.54 across plan + run telemetry (includes pre-compaction finalize/transient/codex work). Per-intent plan+impl ran ~$5–9; the costliest single run was flaky-serial plan ($4.76, deep adversary engagement on the open-ended design choice).

## Open for the operator

- **deterministic-model-tiering-policy** — decision locked to **static per-phase floors** (review/shrink cheap, actuator floored, plan strong); needs sub-role→model config granularity built first. Goes through plan→run.
- **actuator-role-model-floor** — the floor half of the above; implement within the tiering work.
- **check-fix-unsafe-rewrites-nonnull-assertions** — new harness-trap intent (gate autofix vs typecheck).
