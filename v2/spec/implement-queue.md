# v2 implement queue

Authority: operator priorities. Updated 2026-08-06 (cluster session).

## Goal

**The implement-blocker cluster is fully landed** (all three seeds, 2026-08-06 cluster session): `target_absent`/`ambiguous` `@mutate` directives now reprompt in-run instead of hard-blocking; the completion commit now formats changed files before staging; and successor steps are now idle-watchdog-bounded so a pre-agent stall settles `role_stalled` and releases the branch claim. These three hand-blocked every subspec of prior sessions. Next session: `intent-workflow-lacks-stale-workspace-reset`, then the remaining seeds (bump `gate-repair-fence` — its Problem A bit finalization this session), then TUI slice 6.

## Start here next (in order)

1. `seeds/intent-workflow-lacks-stale-workspace-reset` — killed intent strands a verdict marker; next intent run fails non-retryably.
2. `seeds/gate-repair-fence` — **bumped.** Its Problem A (`ready_gate_out_of_scope` refuses repair and settles `resumable:true` over a condition no resume can change) recurred this session: `#2633`'s publication finalization failed three identical resumes on out-of-scope `v1/test/run.test.ts` (a slow v1 test pulled into scope by a `v1/docs` edit; passes in CI). Merged on 3× green CI + clean review.
3. The other open seeds below, then TUI slice 6.

## Landed 2026-08-06 (cluster session — implement-blocker cluster)

| Thread | intent → plan → implement PRs |
| --- | --- |
| **`mutation-directive-target-absent-reprompts`** (reprompt in-run instead of hard-block) | #2628 → #2631 → #2633 |
| **`implement-completion-commit-runs-formatter`** (format changed files before staging) | #2627 → #2630 → #2635 |
| **`successor-step-idle-watchdog`** (00 scope-gate + 01 watchdog; `role_stalled` + claim release) | #2629 → #2632 → #2634 |
| Operator docs + queue reconciliation | this session's close PR |

Notes: each seed ran the full intent→plan→implement pipeline (cursor-first, claude fallback). **Formatter (#2635)** — the workflow successor `role_timeout`'d before pushing, so hand-published the clean completion commit; then hand-fixed a **review-caught blocking defect** (the formatter threw on markdown-only / deletion-only changed sets — `bun biome check --write` exits non-zero "No files were processed" — which would have failed **every** intent-split and plan-draft completion commit; added a biome-eligible-paths filter + regressions). Its own completion commit was also unformatted (import order) and hand-formatted. **Successor watchdog (#2634)** — one implement run landed both subspecs; CI-red on a flaky test (a test-fixture defect: `rehydrateReviewPromptProfile` dropped the test's per-step hang override, so the test raced the real subprocess path under CI load) — subagent-diagnosed and fixed by hanging the registry render. **Reprompt (#2633)** — see Start-here item 2 (out-of-scope v1-test finalization flake). 3 subagent reviews; the formatter review caught the real high-blast-radius bug pre-merge.

## Landed 2026-08-06 (session 1 — verifier + completion-honesty)

| Thread | PRs |
| --- | --- |
| **`mutation-verifier-resolves-from-full-bullet-block`** (wrapped mutation-checkpoint refs resolve) | #2618, #2619, #2620 |
| **`implement-completion-honesty`** (full: preflight gates + write-loop settlements + daemon projection) | #2621, #2622, #2623 (00), #2624 (01), #2625 (02) |

## Landed 2026-08-05 (prior session)

| Thread | PRs |
| --- | --- |
| Bundle 1: mutation-checkpoint-verifier-trust | #2602, #2603, #2604 |
| Claude blindness fix (`--include-partial-messages`) | #2605, #2606, #2607, #2609 |
| Bundle 2 branch: criteria-based-subspec-routing (Problem B) | #2613 |
| Harness-defect seeds | #2608, #2611, #2614 |

| TUI slice | Shipped |
| --- | --- |
| 1–5 | complete |
| 6 — steering + log | **not seeded** |

## Open seeds — in recommended order

| Order | Seed | Notes |
| --- | --- | --- |
| 1 | `seeds/intent-workflow-lacks-stale-workspace-reset` | Killed intent strands a verdict marker; next intent run fails non-retryably. |
| 2 | `seeds/gate-repair-fence` | **Bumped** — Problem A (`ready_gate_out_of_scope` refuses repair, resume can't clear it) blocked `#2633` finalization this session (3 identical resumes on slow out-of-scope `v1/test/run.test.ts`). Also: repair write fence, autofix-turns-tree-red. |
| 3 | `seeds/pipeline-stage-settlement-honesty` | pipeline marks implement `failed` while the run is still live. |
| 4 | `seeds/mutation-checkpoint-criterion-must-name-enclosing-test` | strict linker needs the criterion to name its enclosing test. |
| 5 | `seeds/pipeline-plan-stage-orphans-ready-intent` | Pipeline plan stage doesn't consume its ready-intent. |
| 6 | `seeds/plan-review-must-falsify-guard-premises` | Extends the verifier bundle 1 rewrote. |
| 7 | `seeds/plan-intent-write-steps-lint-own-markdown` | Small, standalone. |
| 8 | `seeds/intent-landing-contract-rejects-wrapped-bullets` | Small, standalone. |

`seeds/tui-waitstate-is-polled-but-no-longer-rendered` rides TUI slice 6.

## Carried operator notes

- **Throttle concurrent implement runs — the cluster session proved it again.** Three implements + their successors running at once saturated the machine; the slow `v1/test/run.test.ts` (>2min under load) then timed out in `#2633`'s finalization gate and settled `ready_gate_out_of_scope`, which no resume could clear (three tried). Run ~2 implements max; stagger; let the machine quiet before a finalization resume.
- **A successor `role_timeout` (or idle stall) can leave the write's work committed-but-unpushed with no PR.** Recovery is hand-publish: push the clean completion-commit `HEAD` (not the dirty tree — a timed-out shrink leaves stranded partial edits on disk that must be discarded, per Gate-trust), open the PR, run CI + a subagent diff review. `#2635`'s formatter did exactly this.
- **Expect to hand-format the completion-commit-formatter PR once.** The run that implements the formatter commits its *own* change before the formatter is active on that commit, so the formatter PR itself lands unformatted (import order) and fails CI `check`. Run `bun biome check --write` on the changed files and push. (After #2635 ships, future runs format their own commits — this is a one-time bootstrap.)
- **A subagent diff review earns its keep on green CI.** `#2635` was CI-green but the review caught a markdown/deletion-only formatter throw that would have broken every intent/plan completion commit. Never merge an implement PR on green CI alone — the review is the gate that catches what the tests don't exercise.
- **`resetStaleWorkspace` now refuses stale reuse (descendant gate, landed this session).** After merging a subspec increment and re-dispatching for the next, the old worktree is not a descendant of the new base → `jarvis cleanup --abandon <branch> --yes`, then re-dispatch.
- **The daemon auto-bounces to the merged build** (observed loaded→current after each merge); a transient `no daemon is listening` can appear mid-bounce — retry the command.
- **`jarvis cleanup --abandon <branch> --yes`** works non-interactively.
- **`jarvis config set-agents` takes a CSV arg** (`claude,cursor`), not space-separated.
- **A `completed`/`no-work` implement row can have committed nothing.** Confirm by PR, not status.
- **CI does not run `lint:md`.** Run it locally before merging any markdown-touching PR.
- **`jarvis run kill` and `jarvis cleanup` are classifier-gated** in auto mode; hand them to the operator's own shell when blocked.
