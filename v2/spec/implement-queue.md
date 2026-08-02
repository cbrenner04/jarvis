# v2 implement queue

Authority: operator priorities. Updated 2026-08-01.

## Goal

The pre-TUI reliability queue is **burned down**, and TUI slices 1-3 are shipped. Next: slices 4-6
of [tui-overhaul-brief.md](tui-overhaul-brief.md) (one intent per slice, not one `plan`).

## Start here next

**TUI slice 4 — detail pane** from [tui-overhaul-brief.md](tui-overhaul-brief.md). Not yet seeded.
Slices 5 (command dock) and 6 (steering + log) follow.

Slices 1-3 shipped 2026-08-01 and `jarvis tui` is a working command center: split panes with a
4-line dock, a live `pipeline → stage[branch] → run` tree with reversible navigation, and
wall-clock elapsed at every level.

| Slice | Shipped |
| --- | --- |
| 1 — shell layout | #2453 (pure geometry), #2456 (ink shell) |
| 2 — pipeline tree | #2462 (poll), #2463 (model), #2466 (wiring) |
| 2 — corrections from review | #2471, #2473 (`e` observable, `j`/`k` reversible, ids match painted rows) |
| 2 — viewport | #2479, #2481, #2485 (full flatten for navigation, bounded paint, scroll-follow) |
| 3 — elapsed columns | #2490 (stage timestamps on the wire), #2492 (elapsed + local tick) |

Harness work that landed alongside, both from defects this session hit repeatedly:

- **#2484** — mutation verification no longer mutates test files. It had stranded three otherwise-finished runs.
- **#2502** — `spec.criteria-ticked` now **verifies** mutation checkpoints: a ticked criterion claiming a mutation turns a pin red must carry a `// @mutate <path> "<old>" -> "<new>"` directive, which the harness applies before accepting the tick. Spec amended first (#2501) to replace prose resolution, which is what the abandoned first attempt (#2498) faked its way through. Authoring rules: [`spec-guidance.md` § Mutation-checkpoint criteria](../../v1/docs/spec-guidance.md#mutation-checkpoint-criteria).

Known gaps in #2502, deliberately left and named in the runbook: the scoped verification run has no
timeout and is not wired to the abort signal, and a `SIGKILL` mid-verification leaves the mutated
file on disk where `git add -A` would commit it.

Two smaller items first if you want a warm-up:

| Seed / intent | Status on `main` | Why now |
| --- | --- | --- |
| `seeds/intent-landing-contract-rejects-wrapped-bullets` | **Seed only.** The contract still reads `## Prerequisites` line-by-line. | Blocked two intent runs on 2026-08-01; each needed a hand-unwrap plus `run resume`. Same class as the shipped human-only fix. |
| `ready-intents/execution-loop-human-only-contracts`, `ready-intents/write-step-rules-human-only-markers` | **Ready.** Siblings of the shipped `spec-parser-human-only-block-match` split. | The parser fix (#2434) closed the operator-visible failure; these extend the same matching to the execution loop and write-step rules. |

### Pre-TUI queue — complete 2026-08-01

| # | Work | Shipped |
| --- | --- | --- |
| 1 | cursor usage parsed then discarded | #2431 (parser), #2433 (telemetry usage), #2440 (shared prices), #2446 (computed list-price cost) |
| 2 | human-only marker read from first line only | #2434 |
| 3 | gate repair does not run the formatter | #2444 |

Cursor agent cost is measurable from #2446 forward (`cost_source: "computed"`, list price — cursor
is subscription-billed, so it is not invoiced spend). Rows before it read `unavailable` or
`no-price` and cannot be compared.

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

- `seeds/tui-tests-bypass-the-render-path` — folded into `seeds/tui-shell-layout`: no real ink painting on CI (#2417–#2418); assert via injected input hook + production monitor state.
- `pipeline_list` timestamps — shipped: pipeline `createdAt`/`finishedAtMs` in #2463, stage `startedAt`/`endedAt` in #2490.
- Delete stub `seeds/queue-widget-refactor.md` (operator notes only, no acceptance criteria) — folded into `seeds/tui-shell-layout`.

## Rule

No reliability phase is open beyond the tables above. Pipelines are done; TUI is the next phase brief.

## Configured pipeline: dogfooded once, one defect found and fixed

`jarvis pipeline start jarvis --seed <path>` was exercised on 2026-08-01. The intent stage
fan-out worked; the approval gate did not. Approving one branch dispatched *every* branch's next
stage, including siblings still `awaiting`, and the resulting sibling failure made the pipeline
refuse `pipeline resume` with `multiple_failed_stages` — unrecoverable, so the work finished
through `jarvis run workflow`. Fixed in #2447 (continuation is now scoped to the approved
`branchKey`, with a predecessor guard).

**Re-verified 2026-08-01** on pipeline `6155fe8b` (TUI slice 2 seed): approving two of three
fan-out branches left the third `awaiting` and dispatched only the approved branches — #2447 holds.

That same run exposed a new defect: concurrently dispatched sibling `plan` stages contend on the
prior intent worktree's claim. One stage recorded `failed` (`worktree_claimed: intent: …`) while its
own invocation ran to completion and opened a PR, and the pipeline then derived terminal `failed`
while a sibling was still `running`. Seed:
`seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`. Until it ships, fan-out
pipelines need branch gates approved **one at a time**, and a terminal `failed` must be confirmed
against `jarvis run list` before you believe it.

## Phase gate — per-project pipelines: **complete**

`jarvis pipeline start | list | wait | approve | reject | resume` work through `implement`.
Plan completion records a bare spec directory on the stage artifact; chained implement
resolution normalizes directory `specPath` to `<dir>/index.md` in `resolveImplementStage`
before preset build.

| Work | State |
| --- | --- |
| Slices 1–6 (definitions, records, execution, gates, CLI, terminal actions, e2e) | shipped |
| Inter-stage handoff: ready-intent file + prior-worktree resolution | shipped #2359, #2363 |
| Branch-keyed persistence, multi-file handoff, fan-out execution | shipped #2374, #2379, #2385 |
| Branch-aware operator CLI | shipped #2406 |
| `--seed <path>` identity and consumption | shipped #2409, #2411 |
| Stale `pipeline` block no longer refuses `implement` | shipped #2399 |
| Plan→implement handoff: directory `specPath` normalized to `index.md` | shipped |

Operator walkthrough: [`first-workflow-walkthrough.md`](../docs/first-workflow-walkthrough.md) § Configured pipeline.

## TUI prerequisites (on `main`)

| Dependency | State |
| --- | --- |
| Intent fan-out (`pipeline-intent-split-fan-out-execution`) | shipped |
| `terminal-window-renders-finishless-rows` | shipped |
| `pipeline_list` `branchKey` | shipped |
| `pipeline_list` pipeline timestamps | shipped #2463 |
| `pipeline_list` stage timestamps | shipped #2490 |
| Shell layout + ink shell (slice 1) | shipped #2453, #2456 |
| Pipeline tree (slice 2) | shipped #2462, #2463, #2466, #2471, #2473, #2479, #2481, #2485 |
| Elapsed columns (slice 3) | shipped #2492 |
| TUI test strategy (ink vs monitor state) | **decided and shipped** — `v2/docs/test-writing.md` § TUI test strategy |

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

- **Review every implement diff with a subagent before merging.** Across two sessions review caught real defects the green ready gate did not: 8 of 11 implement PRs on 2026-07-31, 6 of 11 on 2026-08-01 — including duplicate React keys that printed into the operator's own TUI on every paint.
- **A ticked mutation-checkpoint criterion was the most common lie.** Five across three specs on 2026-08-01 claimed a mutation turns a pin red; applying it left the suite green every time. #2502 now enforces this at the write boundary, but it only covers criteria carrying a `@mutate` directive — a criterion that makes a mutation claim in prose alone is refused, not silently passed.
- **`jarvis cleanup -y` applies non-interactively.** Piped `y` still cancels (`stdin is not interactive; assuming "no"`); the flag is not `--abandon`-only. Two prior sessions handed cleanup to the operator's shell unnecessarily.
- **A rising test count can hide a coverage loss.** When a change converts a fixture rather than adding one, run the relevant mutation and compare kill counts against `main`.
- **Plans block on dependency chains, and that is correct.** Fan plans only across intents with no shared prerequisite; otherwise ship the root first and re-run.
- **Do not pass `--reset-despite-dirty` on an incomplete spec you care about.** It retires the branch including the remote. Recover with `git fsck --lost-found`.
- **Do not admin-merge over a red check.** It reddened `main` once (#2417).
- **ink does not paint to a fake stdout on CI.** See [test-writing.md § TUI test strategy](../docs/test-writing.md#tui-test-strategy).
- `bun test` **does not typecheck.** Hand-finishing: `bun run check` and `bun run typecheck`.
- **One worktree may still survive `cleanup`:** `20260727T203911Z-intent-split-prompt-by-surface` (predates 2026-07-30, holds modified files). `20260731T040405Z-shared-drop-production-invert-hooks` is archived (#2423); its work shipped as #2395.
