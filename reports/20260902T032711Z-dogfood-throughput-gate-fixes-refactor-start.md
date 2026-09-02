# Session report — dogfood-driven throughput, gate fixes, split-workflow-runner started (2026-09-01)

Operator-present continuation of the structural-recovery work. 34 PRs merged (#3297–#3330). Focus: land the stranded external-route lane, dogfood the new operator-notification sweep, characterize parallelization limits, then fix the two dominant gate taxes and start the split-workflow-runner refactor + land the operator-prioritized resumable-honesty bug.

## Headline outcomes

- **Notification dogfood validated** ([[operator-notified-without-polling]] #3295, authored by a parallel agent) — wired `notificationSinkCommand`, ran the entire session's react-to-events loop off it. 86 incidents, zero run-status polling. Reliable on the actionable subset (5 `terminal:failed`, 4 `run-blocked`). Chatty for standalone workflows (one incident per terminal run row); invocation-rollup follow-up is the improvement.
- **Parallelization limits** (operator ask) — intents/plans ~free (13 concurrent = load ~4); implements **2 clean / 3 saturates** (3 gates peaked load 15.6, ~30 `bun` workers, 1 review step lost to contention). 2 is the ceiling.
- **Two dominant gate taxes fixed:** render-coverage over-strictness (#3324) and the brittle line-keyed settlement guard (#3330).
- **Operator-prioritized bug fixed:** resumable-honesty (#3327).
- **Refactor started:** split-daemon 2 slices landed; split-workflow-runner extract-review-debate 2/3 done (handoff in the brief).

## Implementation PRs

- **External-spec:** route lane #3297 (hand-finished).
- **Daemon/execution refactors:** execution-terminal-settlement-invariant subspec 02 #3310; inject-cli-workflow-attach-wait-deps #3311; extract-daemon-tail-stream-and-peer-socket #3312.
- **Gate fixes:** render-coverage-exempts-prompt-metadata-and-deletions #3324; terminal-settlement-guard-line-independent-inventory #3330.
- **Bug fix:** intent-resume-computes-resumable (`settleIntentResumeFailure` honesty) #3327.
- **Prompt-corpus:** plan-draft-rules-single-source #3317; prompt-template-variants #3316; eliminate-prompt-string-surgery #3325.
- **Intent splits (10 seeds → ready-intents):** #3298–#3305, #3308, #3309.
- **Plan specs merged:** #3306, #3307, #3314, #3315, #3319, #3323, #3329.
- **Seeds/docs:** #3296 (ci-test-scope seed), #3313 (ledger + 2 gate seeds), #3318 (render-coverage seed), #3321/#3322/#3326/#3328 (intent/plan/spec of the two gate fixes).

## What each gate fix does

- **render-coverage (#3324):** `promptBodyBounds` excludes frontmatter; `hasBodyAddLines` gates the exemption so metadata (`revision`) bumps + pure deletions are exempt while body adds still require killing coverage. Removes the strand that hit every prompt-corpus dedup (`missing-render-coverage`).
- **settlement guard (#3330):** `terminalWriteKey`/`nonterminalSetRunStatusKey` drop the absolute line number from their equality key. Line drift (merges included) no longer reddens the guard; it no longer strands unrelated implements at ready-gate repair. Unblocks all `workflow-runner.ts` extractions.
- **resumable-honesty (#3327):** `settleIntentResumeFailure` computes `loop_finished.resumable` from `resolveIntentFinalizationResumeContext(...).ok` — the same predicate `jarvis run resume` uses — so the projected `resumable`/`nextAction` cannot disagree with admission. Review-debate caught that a static outcome-kind set (my spec's premise) would invert the bug for populated-stage paths.

## Open / handoff

- **split-workflow-runner extract-review-debate — 2/3 done, NOT merged.** Extraction + test co-location complete in `v2/spec/20260901T112459Z-extract-review-debate-landing-module/`; needs killing tests for 4 guards in the new `workflow-runner-debate-landing.ts` (L222/246/251/282) + subspec 02 doc. Full detail in the brief close-status section. Re-dispatch fresh (guard fix #3330 unblocks it) or hand-author the tests. Then extract-workflow-runner-resume + twin-dedup (pure refactor now).
- **#3114 plan-gate multi-surface-AC strictness — still open.** Blocked ~4 sound plan drafts; plan lane circuit-broken; fix direction operator-held (reprompt-loop vs prompt enforcement) — decide before building.
- **Notification invocation-rollup** — collapse per-run-row completions to one workflow-terminal incident; candidate seed.
- **Deferred lower-priority:** external `chain-*`/`archive-*` lanes; the rest of the P2/P3 ready-intent queue from the 10-seed fan-out.

## Process notes

- **Hand-finish pattern recurred** (route, plan-draft-rules, eliminate-prompt-string, execution-terminal-02): merge current main + scoped biome fix + gate + subagent review + PR. Root causes now seeded/fixed (autofix repo-wide #3313 seed; brittle guard #3330; render-coverage #3324).
- **Merge-during-implement hazard reconfirmed** — merging PRs while an implement is live caused a transient daemon supersede that stranded extract-review-debate `unsupported_resume_context`. Batch merges at idle.
- **Agent order** kept codex → cursor → claude throughout (codex quota/error-terminal as usual; cursor the de-facto actuator).
- Every code implement independent-subagent- or review-debate-reviewed. Subagent review on #3310 caught the brittle-guard inventory going stale (regenerated), not a code defect.
