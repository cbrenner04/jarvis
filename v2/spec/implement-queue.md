# v2 implement queue

Authority: operator priorities. Updated 2026-07-31 evening.

## Goal

Burn a short pre-TUI reliability queue, then open [tui-overhaul-brief.md](tui-overhaul-brief.md) (six intent slices, not one `plan`).

## Start here next

Pre-TUI — convert seeds to intents in this order; skip a row only when the session is blocked on something else.

| # | Seed / intent | Status on `main` | Why now |
| --- | --- | --- | --- |
| 1 | `seeds/cursor-usage-is-parsed-then-discarded` | **Seed only** (#2422). `parseCursorJsonOutput` still returns `{ displayText }`; usage is dropped. | Cheap fix; until it ships, agent cost in telemetry and reports is unmeasured for cursor (~99% of invocations). |
| 2 | `seeds/human-only-marker-read-from-first-line-only` | **Open.** `isHumanOnlyCriterion` still `endsWith` on the first line only (`shared/spec-parser.ts`). | Plan agents write `(Manual)` leading; five runs stranded at `contract_miss` this session. |
| 3 | `seeds/gate-repair-does-not-run-the-formatter` | **Open.** No formatter autofix before agent repair. | Formatter-only red gates exhaust repair budget; standing stopgap is hand `bun run fix` + resume. |
| 4 | `seeds/human-only-marker…` done → **TUI slice 1** from [tui-overhaul-brief.md](tui-overhaul-brief.md) | Brief written; prerequisites below. | Primary operator surface after the three seeds above. |

### Defer unless you hit them in session

| Seed / intent | Status | Notes |
| --- | --- | --- |
| `seeds/iteration-timeout-discards-completed-subspecs` | Open (`iteration_timeout` still `resumable: false`) | Largest scope. Workaround: split large subspecs at plan time; never `--reset-despite-dirty` on incomplete specs you care about. |
| `seeds/out-of-scope-gate-classification-strands-caused-failures` | Open | Run-caused test failures classified out of scope (#2313). |
| `seeds/mutation-verification-artifact-reached-the-completion-commit` | Open | Mutation artifact shipped in completion commit (#2314). |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Ready | Hygiene; retry now that #2370 names the normalizer reason. Not blocking TUI. |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Ready | Only if a hung test descendant is observed. |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Ready | Prereq to later review work only. |

### Fold into TUI (do not queue separately)

- `seeds/tui-tests-bypass-the-render-path` — resolve in TUI slice 1 as a doc decision: no real ink painting on CI (#2417–#2418); assert via injected input hook + production monitor state.
- `pipeline_list` timestamps (`createdAt`, stage `startedAt`/`endedAt`) — `branchKey` is already on the wire; add timestamps in TUI slice 3 (elapsed columns), not as a standalone seed.
- Delete stub `seeds/queue-widget-refactor.md` when opening TUI slice 1 (operator notes only, no acceptance criteria).

## Rule

No reliability phase is open beyond the table above. Pipelines are done; TUI is the next phase brief.

## Phase gate — per-project pipelines: **COMPLETE and dogfooded**

`jarvis pipeline start | list | wait | approve | reject | resume` works end to end, including intent-split fan-out.

| Work | State |
| --- | --- |
| Slices 1–6 (definitions, records, execution, gates, CLI, terminal actions, e2e) | shipped |
| Inter-stage handoff: ready-intent file + prior-worktree resolution | shipped #2359, #2363 |
| Branch-keyed persistence, multi-file handoff, fan-out execution | shipped #2374, #2379, #2385 |
| Branch-aware operator CLI | shipped #2406 |
| `--seed <path>` identity and consumption | shipped #2409, #2411 |
| Stale `pipeline` block no longer refuses `implement` | shipped #2399 |

Operator walkthrough: [`first-workflow-walkthrough.md`](../docs/first-workflow-walkthrough.md) § Configured pipeline.

## TUI prerequisites (on `main`)

| Dependency | State |
| --- | --- |
| Intent fan-out (`pipeline-intent-split-fan-out-execution`) | shipped |
| `terminal-window-renders-finishless-rows` | shipped |
| `pipeline_list` `branchKey` | shipped |
| `pipeline_list` timestamps for elapsed columns | **not shipped** — slice 3 |
| TUI test strategy (ink vs monitor state) | **undecided** — slice 1 |

## Guard-inversion: **CLOSED**

Prevention (#2384), removal across shared/daemon/CLI/execution-loop/TUI (#2395, #2398, #2392, #2402), and a static guard in `bun run check` (#2405) with **zero allowlist entries**.

Watch for disguises a static guard cannot catch: production exports that exist only for test import, and inversion tests asserting against local helpers rather than production (#2406).

## Backlog (deferred / low — no ordering)

`daemon-child-output-test-races-process-startup` (mitigated #2208),
`publication-tails-are-consolidated`, `materialization-base-drift-guard`,
`implement-review-bounds-diff-payload`, `review-checkpoint-reuse-is-not-scoped-to-a-dispatch`,
`set-agents-accepts-any-string-including-flags`, `reviewer-verification-command`,
`surface-the-completion-commit-error-instead-of-swallowing-it`,
`archival-refusal-names-why-owner-was-not-retired`.

## Carried operator notes

- **Review every implement diff with a subagent before merging.** Review caught real issues in 8 of 11 implement PRs this session that a green ready gate did not flag.
- **A rising test count can hide a coverage loss.** When a change converts a fixture rather than adding one, run the relevant mutation and compare kill counts against `main`.
- **Plans block on dependency chains, and that is correct.** Fan plans only across intents with no shared prerequisite; otherwise ship the root first and re-run.
- **Do not pass `--reset-despite-dirty` on an incomplete spec you care about.** It retires the branch including the remote. Recover with `git fsck --lost-found`.
- **Do not admin-merge over a red check.** It reddened `main` once (#2417).
- **ink does not paint to a fake stdout on CI.** See seed `tui-tests-bypass-the-render-path`.
- `bun test` **does not typecheck.** Hand-finishing: `bun run check` and `bun run typecheck`.
- **One worktree may still survive `cleanup`:** `20260727T203911Z-intent-split-prompt-by-surface` (predates 2026-07-30, holds modified files). `20260731T040405Z-shared-drop-production-invert-hooks` is archived (#2423); its work shipped as #2395.
