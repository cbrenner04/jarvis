# Operator session — 2026-06-22 (intent batch)

Jarvis-on-Jarvis operator run: drove the wip-intent queue through plan→run→merge, reviewed every PR, admin-merged on a green gate. Continuation of the prior operator session (post-compaction).

```sh
claude --resume ead0c37c-a08d-4dd5-9510-6a0287846a43
```

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

## Cost / tokens / timing breakdown

*Final successful plan+run per intent (plans opus; runs haiku actuator). Cost/tokens/time from each run's summary stdout.*

| Intent | Plan (model · $ · time) | Run (model · $ · time) | Tokens in→out (plan / run) |
| --- | --- | --- | --- |
| correct-agent-default-models | opus · $2.47 · 7m | haiku · $2.27 · 22m | 13k→20k / 8k→31k |
| agent-transient-retry-backoff | opus · $2.72 · 7m | haiku · $2.46 · 28m | 13k→23k / 8k→51k |
| flaky-serial-retry-mid-work | opus · $4.76 · 13m | haiku · $3.99 · 46m¹ | 13k→42k / 9k→89k |
| intent-split-emit-contract | opus · $3.03 · 8m | haiku · $3.34 · 36m² | 13k→27k / 8k→85k |
| intent-pr-auto-ready | opus · $2.78 · 7m | haiku · $3.64 · 36m¹ | 16k→17k / 6k→81k |
| harness-suggestion-intake | opus · $2.17 · 7m | haiku · $1.46 · 16m | 12k→19k / 8k→23k |
| finalize-complete-but-dirty (#390) | opus · — (prior session) | haiku · ~$6.75³ · — | — / — |

¹ Includes a ~23-min review-actuator stall killed only by the blunt 30-min iteration timeout (no idle watchdog on the running harness — the very thing #390 fixes). ² Run first errored on a `check:fix:unsafe`-induced typecheck failure (the `noNonNullAssertion` trap, [[check-fix-unsafe-rewrites-nonnull-assertions]]); resolved by an operator gate-compat fix + finalize re-run. ³ #390's plan was prior-session; this is the `finalize-complete-but-dirty-run` namespace total across re-drives (original stalled run that was killed, the gate-red finalize, and the post-watchdog-fix finalize) plus operator hand-debug. The standalone pre-compaction finalize run was $4.05 (exited agent-error). Hand-finalized.

**Jarvis telemetry spend (2026-06-22):** ~$59.54 across all plan+run summaries in `runs.jsonl` (includes the pre-compaction harness-transient / codex-path-cache / finalize work and all re-runs). Per-intent plan+impl landed ~$4–9.

### Operator session (this Claude) — separate

Tracked by Claude Code's `/cost` (not in `runs.jsonl`), on top of the telemetry spend above.

```text
  Total cost:            $97.88
  Total duration (API):  2h 27m 8s
  Total duration (wall): 17h 23m 30s
  Total code changes:    818 lines added, 161 lines removed
  Usage by model:
      claude-haiku-4-5:  1.3k input, 35 output, 0 cache read, 0 cache write ($0.0015)
       claude-opus-4-8:  67.7k input, 586.5k output, 138.2m cache read, 1.4m cache write ($97.87)
```

**NOTE**: this includes the other 2026-06-22 costs. The 50/50 split on cost between the operator and jarvis runs seems to be continuing.

## Open for the operator

- **deterministic-model-tiering-policy** — decision locked to **static per-phase floors** (review/shrink cheap, actuator floored, plan strong); needs sub-role→model config granularity built first. Goes through plan→run.
- **actuator-role-model-floor** — the floor half of the above; implement within the tiering work.
- **check-fix-unsafe-rewrites-nonnull-assertions** — new harness-trap intent (gate autofix vs typecheck).
