# Operator session — chess-mvp-yolo blockers, top infra/TUI priorities, and the pipeline completion/settlement path

UTC close: 2026-08-28T14:37Z (session spanned 2026-08-24 → 2026-08-28 with long operator-away gaps). Agent order: **codex-first until quota, then claude**; codex carried the early intents/plans, then exhausted — the entire second half ran on **claude**.

## Headline

Both chess-mvp-yolo dogfooding blockers closed, the two standing top priorities (infra #2181, the TUI attention segment) landed, the `jarvis cleanup <project>` feature shipped, and — the through-line — the **pipeline completion/settlement path that was systematically wedging every pipeline this session was root-caused and fixed end-to-end**. **17 PRs merged, 0 left open.**

The dominant dogfooding finding: **every `full-review` pipeline this session failed to complete end-to-end and required hand-salvage** — keystone (implement `iteration_timeout`), fan-out (plan debate review `role_stalled` ×3), split (implement blocked), cleanup-project (settlement wedge, ~14h idle before caught), TUI (`completion_commit_failed` → settlement wedge on a *fresh* daemon). The work was always correct; the terminal completion/settlement step was broken. This session **landed the fixes for it**: daemon-restart settlement re-drive (#3010), live-daemon `pipeline resume` of a deferred stage (#3012), and implement self-publish when the branch is ahead of base (#3015).

## Chess-mvp-yolo blockers (both CLOSED)

- **#2982** — keystone/mutation test-file matching was JS-only, so Swift/Ruby/Go/Python keystones were systematically rejected `contract_miss`. Fixed: [#2990](https://github.com/cbrenner04/jarvis/pull/2990) — `isTestFileReference` → shared basename-only `isCheckpointTestFileReference` (language-neutral), routed through guard/keystone selection, hollow-pin detection, premise-reachability, and completion-time pin extraction; the plan-draft rejection now names the filename-pattern mismatch. Seed authored ([#2985](https://github.com/cbrenner04/jarvis/pull/2985)) → dogfooded through `full-review` → salvaged from an `iteration_timeout` and hand-published.
- **#2984** — `pipeline recover` refused every fan-out lane. Fixed: [#2994](https://github.com/cbrenner04/jarvis/pull/2994) — narrows a fan-out recovery resolution to the named lane's paired result instead of blanket-refusing. Seed [#2985] → plan [#2991](https://github.com/cbrenner04/jarvis/pull/2991) → implement salvaged (hollow keystone pin) and hand-published.

## Top standing priorities (both landed)

- **#2181** (top infra: the `workflow-runner.test.ts` per-file-timeout wall red-gating PRs). Two-phase per operator direction: stopgap [#2992](https://github.com/cbrenner04/jarvis/pull/2992) (budget 180k→420k) to unblock the parked [#2981](https://github.com/cbrenner04/jarvis/pull/2981), then the durable fix [#2999](https://github.com/cbrenner04/jarvis/pull/2999) — split the 11.9k-line/224-test monolith into 9 concern-grouped `workflow-runner-*.test.ts` files + shared support (**224-test invariant verified**), reverted the stopgap to 180k, split files pooled. Full-suite CI green at 180k. Seed [#2993](https://github.com/cbrenner04/jarvis/pull/2993).
- **TUI attention segment** (top remaining TUI priority) — [#3007](https://github.com/cbrenner04/jarvis/pull/3007): needs-attention surfaces only actionable-now incidents (gates always; terminal failures only within a 12h recency window; undated never), heading counts the surfaced set, and the six-row cap is split so the current gate is never displaced. 259 TUI tests green.

## Pipeline completion/settlement fixes (the through-line)

- **#3010** — daemon start re-drives a stage wedged `settlement_deferred`/`entry_run_still_live` behind a durably-terminal entry run (completed→succeeded + dispatch successor + publish; failed→failed; live→untouched; reconciled-this-start→deferred to `recoverReconciledRuns`).
- **#3012** — `pipeline resume` recovers the same wedge on a live daemon (no bounce). Together these complete `pipeline-settlement-survives-daemon-restart` via intent [#3008](https://github.com/cbrenner04/jarvis/pull/3008), plans [#3009](https://github.com/cbrenner04/jarvis/pull/3009)/[#3011](https://github.com/cbrenner04/jarvis/pull/3011).
- **#3015** — `implement` completion now publishes when the branch is ahead of base (diffs the forced tail commit against `baseRef`, rolls back an empty one), closing the #2958 "completed but no PR" gap that forced a hand-publish on every standalone implement this session. Intent [#3013](https://github.com/cbrenner04/jarvis/pull/3013), plan [#3014](https://github.com/cbrenner04/jarvis/pull/3014). Subspec 01 (identity-from-commit-attribution) deferred as an unchecked subspec after the implement prematurely completed.

## Other landed

- `jarvis cleanup <project>` positional scoping — [#3002](https://github.com/cbrenner04/jarvis/pull/3002) (feature; seed [#2989](https://github.com/cbrenner04/jarvis/pull/2989)). Scopes worktree retirement + stranded-spec scanning to one registered project; global socket-reaping stays global.
- `ready-gate-failure-detail-names-the-gate-output` — [#2981] (prior-session parked draft, unblocked by the #2992 stopgap, rebased, merged).

## Seeds authored

`keystone-test-file-matching-is-language-neutral` (#2982) & `pipeline-recover-lands-fan-out-lanes` (#2984) [#2985]; `cleanup-scopes-to-a-named-project` [#2989]; `split-workflow-runner-test-file` [#2993]; `plan-review-failure-preserves-and-recovers-the-good-draft` (#2995) [PR #2995]; `operator-killed-pipeline-stage-is-recoverable` (triaged from operator issue **#2996**) [PR #3003].

## Findings / friction (for follow-up)

1. **Pipeline completion/settlement was systematically broken** — every pipeline wedged at the terminal step via several distinct paths (settlement-deferred orphan, `completion_commit_failed` non-settle, plan review `role_stalled`). Core fixes landed (#3010/#3012/#3015); remaining seeded: `pipeline-stage-stuck-running-after-failed-run` (#2960), `operator-killed-pipeline-stage-is-recoverable` (#2996), `plan-review-failure-preserves-and-recovers-the-good-draft` (#2995).
2. **Codex debate-review `role_stalled`** — the plan debate review stalled to non-retryable `harness_failure` on multiple specs (fan-out ×3, split ×1), stranding a good draft; `resume` redrafts, `recover` refuses. Seeded (#2995).
3. **Implement premature-completion after one subspec** — the #2958 implement completed after subspec 00, leaving 01 undone *and* a dangling cross-subspec reference (typecheck break). Recurs; ties to `implement-premature-completion-and-salvage`.
4. **Plan-drafted hollow / split keystone pins** — recurring `contract_miss (spec.criteria-ticked): unparseable/unresolved` at implement completion (empty `Keystone checkpoint:` markers, or marker split from its `@mutate` directive across two AC bullets). Hand-demoted at salvage. Ties to reverted #2706.
5. **Agent cannot clean-bounce the daemon** — force-killing daemon procs is auto-mode-classifier-gated, so an agent can only `daemon start`; repeated starts (needed to pick up each merge's fresh code) bred multiple daemon stragglers sharing the store, which *resumed orphaned merged-work runs* into live-but-unkillable zombies. **Daemon bounces must be a single operator-shell `pkill -f daemon-entrypoint.ts && jarvis daemon start`.** Runbook-worthy.
6. **`run kill --force` only settles `paused`** — reports `run_not_active` on an `in-progress`-but-not-live zombie, so those stuck rows have no operator settle verb.

## Open state at close

- **0 open PRs.** Open issues: **#2996** (seeded, awaiting implementation) and **#1453** (old sandbox-policy, owner flagged to confirm assumptions).
- **Daemon: needs an operator-shell reset** — 4 stragglers (`pkill -f daemon-entrypoint.ts && jarvis daemon start`); two zombie runs (`02e3f4ae`, `7b6fffef`) on already-merged branches settle on the single fresh daemon.
- `jarvis cleanup` deferred to the operator's shell (needs an interactive TTY; several session worktrees to retire).
