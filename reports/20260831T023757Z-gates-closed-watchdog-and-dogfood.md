# Session report — 2026-08-30/31 (gates closed, watchdog trio, dogfood support)

Jarvis-on-Jarvis operator session (continuation of the structural-recovery drive). Agent order `codex, cursor, claude` (codex quota'd throughout; cursor was the actuator for every implement/plan). This session closed the mutation-gate P0 class, landed the plan-gate shape fix, fixed a review-posture regression the operator caught, and landed the first of the two remaining watchdog-trio slices — plus live support for the operator's chess/homestead pipeline dogfooding.

## Landed (merged to main)

| PR | What |
| --- | --- |
| [#3197](https://github.com/cbrenner04/jarvis/pull/3197) | **P0 linchpin** — `implement-verifies-mutations-in-loop` (in-loop diff-derived mutation verification + live-agent reprompt). Finished the banked draft: added render-observer coverage for its new prompt, root-caused the render-coverage-from-daemon-build bug, merged on review + coverage-repro |
| [#3199](https://github.com/cbrenner04/jarvis/pull/3199) | Hand-landed scanner-candidate plan (blocked on `plan.draft.shape`) + render-coverage seed |
| [#3200](https://github.com/cbrenner04/jarvis/pull/3200) | Hand-landed persist-events plan + ledger |
| [#3201](https://github.com/cbrenner04/jarvis/pull/3201) | **P1** — `harness-publication-push-uses-explicit-refspec` (explicit `HEAD:refs/heads/<branch>`). Auto-published clean |
| [#3202](https://github.com/cbrenner04/jarvis/pull/3202) | **P0** — `derive-mutation-candidates-from-typescript-scanner` (regex → AST operator-flip classification). Auto-published clean |
| [#3203](https://github.com/cbrenner04/jarvis/pull/3203) | `plan-draft-shape-accepts-nested-stage-layout` intent |
| [#3205](https://github.com/cbrenner04/jarvis/pull/3205) | `cleanup-uses-lossless-git-status` implement — hand-salvaged after the verifier crashed non-resumably on a mis-derived guard-flip; review clean |
| [#3206](https://github.com/cbrenner04/jarvis/pull/3206) | guard-flip-crash + pipeline-resume-dirty seeds + evening-2 ledger; reaped persist-events (dropped) |
| [#3207](https://github.com/cbrenner04/jarvis/pull/3207) | homestead migration follow-up note on the #3122 seed |
| [#3208](https://github.com/cbrenner04/jarvis/pull/3208) | `plan-draft-shape-accepts-nested-stage-layout` plan (drafted clean through Jarvis; scrubbed dead `@mutate`) |
| [#3209](https://github.com/cbrenner04/jarvis/pull/3209) | `contain-unappliable-mutation-candidate` spec + pipeline-resume-dirty seed |
| [#3210](https://github.com/cbrenner04/jarvis/pull/3210) | review-posture regression seed |
| [#3211](https://github.com/cbrenner04/jarvis/pull/3211) | **P0** — verifier-crash **containment**: skip an unappliable candidate (record on `skippedCandidates`) instead of re-throwing → `run_execution_failed`. Review clean |
| [#3212](https://github.com/cbrenner04/jarvis/pull/3212) | **P0** — `accept-nested-plan-draft-stage-layout` implement (**closes issue #3156**). Re-ran clean on the containment-fixed build; hand-covered one reformatted guard. Review clean |
| [#3213](https://github.com/cbrenner04/jarvis/pull/3213) | whitespace-only-line-change mutation seed (the reprompt-detour class) |
| [#3214](https://github.com/cbrenner04/jarvis/pull/3214) | `implement-stage-threads-review-posture` spec |
| [#3215](https://github.com/cbrenner04/jarvis/pull/3215) | spec fix — corrected an unrealizable `implement`+`none` AC (agent blocked on it correctly) |
| [#3216](https://github.com/cbrenner04/jarvis/pull/3216) | **Regression fix** — `resolveImplementStage` now threads `reviewPasses`/`reviewBehavior`; `fast` pipeline implements run light review, not debate. Review clean |
| [#3217](https://github.com/cbrenner04/jarvis/pull/3217) | `idle-watchdog-counts-worktree-activity` spec |
| [#3218](https://github.com/cbrenner04/jarvis/pull/3218) | **P0 watchdog-trio** — idle watchdog re-arms on worktree file writes (injectable, sidecar-filtered). Hand-salvaged from a non-resumable strand; review clean |
| [#3219](https://github.com/cbrenner04/jarvis/pull/3219) | idle-watchdog sidecar-filter (any-segment) follow-up seed |
| [#3220](https://github.com/cbrenner04/jarvis/pull/3220) | brief + ledger refresh through this session |

**22 PRs merged.** 8 are code implements (#3197, #3201, #3202, #3205, #3211, #3212, #3216, #3218), each independent-subagent-reviewed before merge; the rest are specs/plans/seeds/docs.

## Key findings

1. **The mutation-gate P0 class is closed (4/4)** — escape-hatch #3188, in-loop verification #3197, scanner-based derivation #3202, importer-killing #3195 — plus the verifier-crash **containment** #3211. The gate now crashes recoverably (skips unappliable candidates instead of a non-resumable `run_execution_failed`), false-flags less, and strands resumably. Proof: #3201/#3202 were the first clean auto-publishes at the mutation gate this session; #3212 re-ran clean once containment unblocked it.
2. **The verifier crash was the dominant late blocker** — a mis-derived guard-flip candidate (`!obj.method()` sliced as `!obj`) re-threw `Failed to test candidate`, killing an otherwise-complete run non-resumably. It stranded **two** complete implements (cleanup-lossless, shape-fix) before #3211 contained it. Root-cause slice fix remains as follow-up (`guard-flip-derivation-crash-is-contained`).
3. **Operator caught a live review-posture regression from this session's own front-door work** — `resolveImplementStage` dropped `reviewBehavior`, so `fast` pipeline implements ran 4-role debate instead of the defined light critic (telemetry: `{critic,actuator}` → `{adversary,advocate,adjudicator,actuator}` on 8/30). Fixed in #3216. Fix-what-you-broke jumped it ahead of the last watchdog slice.
4. **Watchdog trio 3/4 done** — #3189 (checkpoint resumability) + #3194 (resume admission) + #3218 (silent-edit false-kill). Only `stall-settlement-preserves-agent-stdout` (#3151) remains before serial-only implement can be formally relaxed; 2 concurrent implements are already safe in practice.
5. **Independent review keeps earning its keep** — it caught the render-coverage-from-daemon-build root cause on #3197, verified the containment distinction (unappliable vs. infra error) on #3211, blessed the core watchdog logic on #3218, and confirmed the shape-fix flatten/ambiguity logic on #3212. No implement merged on green gates alone.

## Dogfood support (operator's chess + homestead pipelines)

Live operator questions answered read-only (never launched on their seeds): how to re-kick blocked fan-out plan lanes (`pipeline resume <id> <branch-key>`, merge prereqs first); why `terminalAction: merge` didn't fire (all-lanes-green gate); the dirty-resume gate (seeded `pipeline-resume-clears-blocked-lane-dirty-worktree`); why `recover` refused a `fast` plan stage (`review: none` → no review-landing); the 71 MB `.nnue` Stockfish-net LFS warning; and the review-posture regression (above). Homestead is blocked on #3122 (external implement) — confirmed its prerequisites (`projectSafeId`, #3128 chained-stage matcher) are landed, so it's unblocked whenever prioritized.

## Issues closed / advanced

- **Closed #3156** (plan.draft.shape rejects nested layout) → #3212.
- **Closed #3152** (idle_output_timeout resumable:false despite committed progress) → #3189/#3194.
- **Commented #3150** (partial) — core silent-edit false-kill fixed by #3218; per-project `idleOutputTimeoutMs` override half kept open (pairs with #3026).

## Deferred / dropped

- **persist-events (P0 escape-hatch audit half) DROPPED** (operator call) — redundant with the PR-diff-visible `@mutate-equivalent` directive; also fought biome complexity across 3 finalization functions + a hard-to-cover guard. Plan spec + ready-intent reaped in #3206.
- **execution-terminal-run-settlement-invariant subspec 02** stays deferred (00 #3157, 01 #3167 landed).

## Seeds created

`render-coverage-resolves-observer-map-from-worktree` (#3199), `guard-flip-derivation-crash-is-contained` + `pipeline-resume-clears-blocked-lane-dirty-worktree` (#3206/#3209), `pipeline-implement-stage-honors-review-posture` (#3210), `mutation-verifier-ignores-whitespace-only-line-changes` (#3213), `idle-watchdog-sidecar-filter-matches-any-path-segment` (#3219).

## Friction (one-offs / process)

- **Rapid merge→dispatch cadence caused transient daemon supersedes** that stranded two fresh runs `unsupported_resume_context` (idle-watchdog, persist-events). Both salvageable. Mitigation: space dispatches from merges, batch merges at idle points.
- **Hand-publish leaves spec bookkeeping** — `cleanup-uses-lossless-git-status` (#3205) stayed un-archived until this closeout (archived here); its leaked worktree + others cleaned at close.
- **My `git checkout` mistake on the shape-fix salvage** discarded uncommitted agent reprompt work; recovered by re-running on the containment-fixed build. Runbook warns against exactly this.
- **`daemon status` reads `stopped` after heavy merging** (digest-keyed; the daemon is alive on the prior key). Expected, documented — use `ls daemon-*.sock` + `ps` during merge-heavy sessions.

## Cleanup done at close

Retired 10 leaked worktrees + 4 unregistered husks (git-level, since `--abandon` couldn't reach a current-digest daemon); deleted 10 stale local branches; archived the cleanup-lossless spec to `completed/`; cleaned operator scratch temp files. Daemon (PID 8680) handed to operator to kill (no live runs anywhere). No open PRs.

## Cost

Operator (Claude Code) `/cost`: **$128.04** — 2h22m51s API / 7h42m26s wall, 399 requests (99% input from cache). Nearly all `claude-opus-4-8` ($128.03; 61.6k input, 589.1k output, 195.4M cache read, 1.7M cache write); haiku negligible. 465 lines added / 14 removed (operator-authored; agent-authored code is in the PRs). Agent-side actuator spend (cursor/codex/claude running the workflows) is separate and per-run-queryable from `~/.jarvis/telemetry.jsonl`.
