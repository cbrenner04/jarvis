# 2026-07-19 v2 review/refactor session

Direct-work session (no jarvis runs, per operator): heavy review + refactor of v2, test pare-down, docs currency, spec-dir cleanup. Driven from five parallel code/docs/backlog audits, each claim re-verified in code before acting.

**Net: 138 files, +4,771/−10,571 (−5,800 lines) across 13 PRs. Main green on every CI run since #1802 (was 5 red in the prior 11).**

## PRs (all admin-merged on green)

| PR                                                      | What                                                                                                                                          |
|---------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| [#1802](https://github.com/cbrenner04/jarvis/pull/1802) | CI flake root cause: daemon fire-and-forget promotion raced a closed SQLite store                                                             |
| [#1803](https://github.com/cbrenner04/jarvis/pull/1803) | Dead human/revise feature cluster removed end-to-end (−1,776; nothing ever authored `behavior:"human"`)                                       |
| [#1804](https://github.com/cbrenner04/jarvis/pull/1804) | Spec cleanup: archive shipped, drop plan-only v1 dirs + stale seeds                                                                           |
| [#1805](https://github.com/cbrenner04/jarvis/pull/1805) | Dead seams: prompt barrels, ghReady, NonFastForwardError, tautological status tests                                                           |
| [#1806](https://github.com/cbrenner04/jarvis/pull/1806) | One terminal-status source (was 4 defs); startDaemon name collision fixed                                                                     |
| [#1807](https://github.com/cbrenner04/jarvis/pull/1807) | Review executors collapsed onto shared role invocation + wall clock (seed: review timeout)                                                    |
| [#1808](https://github.com/cbrenner04/jarvis/pull/1808) | Shared diff-scan; mutation-verify bounds (seed); plan stale-reset (seed)                                                                      |
| [#1809](https://github.com/cbrenner04/jarvis/pull/1809) | Config loader single-read DRY; 38→17 test bodies; IPC fakes merged                                                                            |
| [#1810](https://github.com/cbrenner04/jarvis/pull/1810) | v1 cleanup stops archiving v2 specs; cleanup dedup; abandon-flag + stdin-hang seeds fixed (99%-CPU root cause: flowing-mode poll of EOF'd fd) |
| [#1811](https://github.com/cbrenner04/jarvis/pull/1811) | Docs: v2 primary / v1 maintenance-only; 3 executed-plan docs deleted; drift fixed (−975)                                                      |
| [#1812](https://github.com/cbrenner04/jarvis/pull/1812) | TUI tests trimmed to behavioral coverage (−573)                                                                                               |
| [#1813](https://github.com/cbrenner04/jarvis/pull/1813) | Daemon tests 24→19 files; IPC-responsiveness quartet → one parametrized file                                                                  |
| [#1814](https://github.com/cbrenner04/jarvis/pull/1814) | cli.test.ts 3,187→33; per-command test files; review-arg matrix table-driven                                                                  |

## Seeds consumed by direct fixes

closed-db race, review/shrink timeout, mutation bounds, plan stale-reset, cleanup abandon-flag parse, cleanup stdin hang. Backlog: 17 seeds + 3 ready-intents → 6 seeds + 2 ready-intents (`.scratch/spec-priorities.md` is the fresh ranked list).

## Deliberate keeps (against audit advice, each verified)

- Stale-daemon auto-bounce (recent, solves real operator pain)
- `retainListedRuns` 50-terminal cap (working retention policy)
- v1 triage's v2-awareness (deliberate bridge feature)
- Spec-path normalizers not unified (different absolute-path semantics)
- No forced `finalizeCompletion()` unification: the shared primitives already exist
  (`publishWithReadyRepair`, committer, telemetry); what remains is genuine behavioral
  divergence between standalone and workflow completion, not copyable duplication

## Deferred (seeded, not lost)

- `reviewed-plan-workflows-never-land-their-spec` — feature-sized (landing + publication +
  resumption); workaround: plain `plan`
- `shrink-step-invocation-error-strands-write-work` — needs completion-agent threading
- Remote-branch prune (396 stale origin branches) — operator command; classifier blocks agents

## Process notes

- v1 declared maintenance-only; routing docs inverted to v2-primary (#1811)
- `.scratch` purged (~180 files → 3 live docs); ~220 stale local branches and all worktree
  debris deleted; operator opening prompt rewritten (seeding discipline replaces
  "every failure gets a seed")
- Two subagents died at the 7:50pm quota wall; both work products were salvaged or re-run
  and landed (#1813, #1814)
