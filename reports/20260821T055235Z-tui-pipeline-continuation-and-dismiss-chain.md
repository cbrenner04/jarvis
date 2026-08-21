# Operator session — distinguish completion, TUI/pipeline QoL, dismiss chain

UTC close: 2026-08-21T05:52Z. Agent order: **claude only** (per operator direction; quota refreshed once mid-session).

## Headline

Every requested item landed, plus a systemic plan-normalizer fix and the full pipeline-dismiss feature. Both explicit priorities — completing `distinguish-jarvis-commit-steps` and stopping the TUI's ↓ auto-expand — are done. The two QoL seeds (`operator-terminates-stale-nonactive-runs`, `operator-dismisses-pipelines-from-display`) are fully implemented end to end. ~30 PRs merged.

## Implementation PRs (feature landings)

- **distinguish-jarvis-commit-steps** (priority #1, spec complete): [#2919](https://github.com/cbrenner04/jarvis/pull/2919) subspec 00 (Jarvis-Step completion-commit trailer), [#2920](https://github.com/cbrenner04/jarvis/pull/2920) subspec 01 (propagate workflow commit steps), [#2921](https://github.com/cbrenner04/jarvis/pull/2921) subspec 02 (step-aware PR attribution).
- **tui-walk-reveals-without-persisting-expansion** (priority #2): [#2922](https://github.com/cbrenner04/jarvis/pull/2922) — ↓/`j` reveals collapsed nodes for paint without persisting expansion.
- **plan-normalizer-honors-declared-single-surface** (systemic, spec complete): [#2925](https://github.com/cbrenner04/jarvis/pull/2925) subspec 01 (intent split emits the declaration pair the normalizer honors).
- **terminate-stale** (`operator-terminates-stale-nonactive-runs`): [#2927](https://github.com/cbrenner04/jarvis/pull/2927) daemon force-settle on the `kill` RPC, [#2929](https://github.com/cbrenner04/jarvis/pull/2929) `jarvis run kill --force` CLI.
- **dismiss** (`operator-dismisses-pipelines-from-display`): [#2932](https://github.com/cbrenner04/jarvis/pull/2932) store `dismissed_at` + ops, [#2935](https://github.com/cbrenner04/jarvis/pull/2935) `pipeline_dismiss`/`undismiss` RPC + default-excluding `pipeline_list`, [#2938](https://github.com/cbrenner04/jarvis/pull/2938) CLI `pipeline dismiss`/`undismiss`, [#2940](https://github.com/cbrenner04/jarvis/pull/2940) CLI `pipeline list --all`, [#2942](https://github.com/cbrenner04/jarvis/pull/2942) TUI hide-from-projections, [#2943](https://github.com/cbrenner04/jarvis/pull/2943) TUI show-dismissed toggle.

## Supporting PRs (intents / plans / operator declarations / seed)

Intents & plans: #2914, #2915 (down-arrow); #2916, #2917, #2918 (dismiss intents + store foundation); #2923 (terminate intent); #2926, #2928 (terminate plans); #2931 (dismiss-store plan); #2934, #2936 (dismiss rpc/cli plans); #2941 (dismiss tui-display plan, hand-published). Operator single-surface declarations to unblock the normalizer: #2924, #2930, #2933, #2937. Seed: #2939.

## Verification discipline

Every implementation was reviewed AC-by-AC against the production diff before merge (never a bare green-gate trust), the gate re-run locally (`typecheck` + `check` + `lint:md` + affected tests, daemon/socket tests with the sandbox off), and each `@mutate` checkpoint sanity-checked. Several were **salvaged** from stranded runs (see friction) rather than re-run: distinguish 01/02, dismiss-cli 00, dismiss-tui 00/01.

## Friction (harness gaps hit; candidates for the report/seed queue)

1. **Implement "completes" without publishing a PR.** Repeatedly, `implement` finished a subspec, committed, settled `completed`/`done`, but published no draft PR — I hand-published from the worktree. Also: on the multi-subspec distinguish spec, implement declared the whole spec done after only subspec 00 (hollow-checkpoint `@mutate` authoring ate the iteration budget). Memory written (`implement-premature-completion-and-salvage`).
2. **Completion commit refused by the quality gate, leaving work uncommitted/dirty.** Cognitive-complexity (>24) blocked commits on dismiss-cli 00, dismiss-tui 00, and distinguish 01; a `noAssignInExpressions` test-seam lint error blocked dismiss-tui 01. Each was a 1–7 point over-budget function I split by hand, or a one-line lint fix. The agent's *work* was sound each time; only the harness commit step failed. Suggests the write step should run `bun run check` and self-repair complexity/lint before the completion commit, not fail it.
3. **Daemon instability from agent Bash + mid-run supersede.** The daemon repeatedly superseded (digest churn) and sometimes stopped entirely; a plan run that finished during a supersede lost its publication and stranded its worktree claim (`worktree_claimed`), forcing a re-run or a hand-publish of the staged draft (#2941). Daemon lifecycle is operator-owned; flagged.
4. **plan-normalizer single-surface false-positive** blocked every consumer plan whose intent lacked the `Unsplit rationale:` + `## Primary implementation surface` declaration pair. #2925 fixes it going forward (the split now emits the pair); existing intents needed the pair hand-added (#2924/#2930/#2933/#2937). Reliable once understood.
5. **`pipeline-execution.test.ts` CI flake** (`resume branchKey default aliases the unscoped path`) red-gated three unrelated PRs (#2935/#2938/#2940); passes 96/0 in isolation. Seeded (#2939) — extend the #2900 no-co-runner lane to cover it.
6. **`cleanup --abandon` needs an interactive TTY** (piped/`printf 'y\n'` both cancel). Worktree retirement done git-level; hand off `! jarvis cleanup` at close. Memory written (`worktree-retire-before-manual-removal`).
7. **Hollow `@mutate` checkpoints** in the distinguish spec (the prior session's repair-draft was never persisted) forced the implementing agent to author every directive from scratch — expensive, and the source of friction #1's budget exhaustion.

## Stuck state / carryover

- Stuck `paused`/`unsupported_resume_context` runs (e.g. `6055d148`) remain — the new `jarvis run kill --force` clears exactly these but needs the daemon rebuilt to the new binary (operator territory).
- Stray managed worktrees from this session's merged intents/plans await `jarvis cleanup`.
- `dismiss-pipeline-rpc`/`-cli`/`-tui-display` ready-intents were consumed by their specs; `dismiss-pipeline-durable-flag` too. No dismiss ready-intents remain.

## Close-out status

Open-PR sweep: clean. Cleanup: hand off (`! jarvis cleanup`). CSVs: pending `/cost` from operator.
