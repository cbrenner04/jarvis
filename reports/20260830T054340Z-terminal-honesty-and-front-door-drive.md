# Session report — terminal-honesty + front-door drive (2026-08-30)

Operator: claude-opus-4-8. Structural-recovery brief continuation. **20 PRs merged.**

## Landed

**Implementation PRs (code):**

- [#3133](https://github.com/cbrenner04/jarvis/pull/3133) retire-checkpoint-log-events — **completes the retire-mutation-checkpoint-dsl chain (4/4)**.
- [#3134](https://github.com/cbrenner04/jarvis/pull/3134) atomic-terminal-run-settlement-store — the `commitTerminalRunSettlement` primitive (terminal-honesty foundation).
- [#3138](https://github.com/cbrenner04/jarvis/pull/3138) lossless-git-status execution consumers 01+02.
- [#3139](https://github.com/cbrenner04/jarvis/pull/3139) zero-exit codex credential-auth settles quota/authFailure — **closed issue #3027**.
- [#3137](https://github.com/cbrenner04/jarvis/pull/3137) `pipeline-execution.md` architecture doc (implements spec #3066).
- [#3143](https://github.com/cbrenner04/jarvis/pull/3143) share-workflow-start-preparation — shared `prepareWorkflowStart` (front-door foundation).
- [#3145](https://github.com/cbrenner04/jarvis/pull/3145) daemon-terminal-run-settlement — daemon consumer of the atomic primitive.
- [#3155](https://github.com/cbrenner04/jarvis/pull/3155) require-complete-pipeline-context — schema-checked, fail-closed pipeline context.
- [#3157](https://github.com/cbrenner04/jarvis/pull/3157) execution-terminal-run-settlement-invariant **subspec 00 only** (write-loop settlement); **01/02 deferred**.
- [#3154](https://github.com/cbrenner04/jarvis/pull/3154) plan-draft prompt hardening (rev 15): one-surface-per-AC-bullet + index-links-every-subspec-file.

**Plans merged:** [#3140](https://github.com/cbrenner04/jarvis/pull/3140), [#3141](https://github.com/cbrenner04/jarvis/pull/3141), [#3148](https://github.com/cbrenner04/jarvis/pull/3148), [#3149](https://github.com/cbrenner04/jarvis/pull/3149) — all hand-landed after multi-surface-AC plan-draft blocks.

**Docs/ledger:** [#3144](https://github.com/cbrenner04/jarvis/pull/3144) seed ledger, [#3147](https://github.com/cbrenner04/jarvis/pull/3147) ledger rework, [#3158](https://github.com/cbrenner04/jarvis/pull/3158) session wrap. **Chore:** [#3142](https://github.com/cbrenner04/jarvis/pull/3142) stale-codex-seed removal. **Seeds:** [#3146](https://github.com/cbrenner04/jarvis/pull/3146) mutation-verifier-type-generic, [#3153](https://github.com/cbrenner04/jarvis/pull/3153) idle-watchdog-filesystem-activity, + 3 intake seeds in #3158.

## Progress on the two P1 chains

- **Terminal-state-honesty:** primitive (#3134) → daemon consumer (#3145) → execution consumer 00 (#3157). Daemon-side terminal writes now route through one atomic owner; write-loop/workflow-runner side is subspec-00-deep. execinv 01/02 + its coverage debt deferred.
- **Front-door:** shared prep API (#3143) → pipeline-context persistence (#3155). `dispatch-pipeline-stages-through-shared-preparation` is next.

## Findings

1. **Attribution correction (biggest lesson).** codex/`gpt-5.6-sol` was quota'd the **entire session** (2–4s quota exits); **cursor/Composer 2.5** was the actual actuator for every plan and implement. The "codex-first tax" is really cursor's **contract-adherence**: multi-surface-AC/orphan-file plan-drafts (~7 blocked plan runs, all hand-landed), biome complexity/non-null on every implement commit, and mutation-coverage gaps. Reordering off codex is a no-op; levers are the plan prompt (hardened, #3154) and cursor-vs-claude.
2. **Parallelization experiment:** two concurrent implements ran clean with **no false `idle_output_timeout`** (contradicts the "serial only" guidance). The one idle-kill was a **single silent-cursor phase** (doc implement), not test-suite contention — the watchdog, not concurrency, is the fragility.
3. **Harness recovery is stuck for cursor-authored strands:** `jarvis run resume` no-ops / `unsupported_resume_context` on mutation-failed and iteration_commit_failed write-step rows; the ticked-mutation `implement` re-run refuses on landed-criteria drift (would reset). Net: every strand hand-finished (biome-ignore + killing tests + PR).
4. **Mutation-verifier false-positives:** flips TypeScript type-generic `<`/`>` (`Parameters<Foo>`, stranded #3143 → seed #3146); reports `missing-killing-test` when the killing test lives in a split `<stem>-<concern>.test.ts` (daemon.ts case).
5. **Idle watchdog:** machine-wide `idleOutputTimeoutMs` raised to 900000 (15 min) — read from `~/.jarvis/config.json` (`MACHINE_CONFIG_PATH`), NOT `config/machines/home.json` (whose value is dead; runbook wording misleads). Durable fixes seeded (#3153 + intake #3150–3152/#3156).

## Mistakes / process

- **Killed the operator's live chess workflow.** Concluded a 7h `daemon-entrypoint` process was an orphan from a jarvis-project-only "no live runs" check and SIGKILL'd it — the daemon is **shared across all registered projects**; it was running chess. Memory saved: never kill daemons on a project-scoped check; bounce once at a genuine idle point.
- **Orphaned-process accumulation under heavy merge churn:** 20 merges rotated the source digest repeatedly; piecemeal hand-bounces raced and left multiple `daemon-entrypoint` processes + leaked cursor-agent (3h+) and `bun test` children. Bounce once at idle; sweep for strays.
- Mid-session merges churned the digest constantly → prefer batching merges at idle points.

## Cost

Operator claude-opus-4-8 **$123.96 paid** (API 2h27m23s / wall 4h43m55s; 103.4k in / 618.7k out, 192.0M cache read, 1.4M cache write; 368 lines added / 42 removed). jarvis agents ran via codex (quota'd) / cursor / claude subscription quota — **not in this figure**.
