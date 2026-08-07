# v2 implement queue

Authority: operator priorities. Updated 2026-08-07 (slice-6 session close: queue 4/4 + pin-resolution + TUI slice-6 3/5).

## Goal

**2026-08-07 slice-6 session: the operator queue is 4/4 landed and TUI slice 6 is 3/5 implemented.** Queue: gate-repair-baseref-probe (#2683), mutate-directive above-test attribution (#2682), plan-review premise-falsification (#2685), and **mutation-checkpoint-keystone re-scoped to _verify-if-present_ and landed (#2684)** — the original require-a-keystone-on-every-guard-spec gate would have bricked the pipeline (plans don't author keystones), so it was dropped; a declared keystone is still verified (surviving revert → `Inert headline change`; >1 → refused). Also landed: **`mutation-checkpoint-pin-resolution` (#2696)** — multiline `test.each` continuation titles + `.tsx`↔`.ts` extension tolerance in the verifier. TUI slice 6: all 5 plans landed; **waitstate (#2691), unattributed (#2693), and pipeline-steering [4 subspecs] (#2698) implemented** — 3 of 5. Remaining: run-steering and log-follow.

## Start here next (in order)

1. **`20260807T065201Z-tui-dock-run-steering`** (active spec). Its single `00-tui` subspec **timed out at 45min (`iteration_timeout`) this session** — too big for one write iteration — and the committed impl **failed its own tests** (typed `kill`/`pause`/`resume-run` wire to `runSteeringAction` but the RPC does not fire from the typed path: a `runAction` owner/state-resolution gap, `getOwner(runId)`/`runOwners` vs. the typed dispatch). Worktree abandoned. Fix path: **split `00-tui`** into smaller subspecs (mirror pipeline-steering's parser / dispatch / eligibility split) then re-implement, OR debug the `runAction` typed-path owner resolution against `tui-entry.test.tsx` tests `typed kill pause and resume-run steer the selected live run` / `typed resume-run issues a resume RPC and no wait RPC` / `typed run steering on ineligible selection…`. Spec already amended: `resume-run` maps to `runSteeringAction("resume")` (no rewait — waitstate removed it).
2. **`20260807T065201Z-tui-dock-log-follow`** (active spec) — lands last of the chain; marks slice 6 shipped in `tui-overhaul-brief.md`. Depends on run-steering (shared `tui-entry.tsx`/`tui-command-parser.ts`).
3. **Open harness seeds** (both blocked a run): `seeds/plan-intent-completion-ready-gate-runs-full-suite-on-spec-only-diff`, `seeds/plan-review-actuator-edits-bypass-write-step-markdown-lint`. Also `seeds/plan-draft-must-validate-mutation-criterion-names-enclosing-test` (new) — the deferred plan-draft validation that would stop the pipeline-steering-00 / run-steering hollow-authoring class.

## Landed 2026-08-07 (slice-6 session)

| Thread | PRs |
| --- | --- |
| **`gate-repair-baseref-probe-runs-scoped-command`** (v2 terminal steps probe via `runV2TestFiles` at base) | #2675 → #2678 → #2683 |
| **`mutate-directive-above-test-attribution`** (forward-line `enclosingPinTitle`) | #2673 → #2677 → #2682 |
| **`plan-review-premise-falsification`** (advisory `## Unfalsifiable premises` pass) | #2674 → #2679 → #2685 |
| **`mutation-checkpoint-keystone`** (verify-if-present keystone gate; require-gate dropped, re-scoped by operator) | #2674 → #2681 → #2684 |
| **`mutation-checkpoint-pin-resolution`** (multiline `test.each` titles + `.tsx`/`.ts` extension tolerance) | #2694 → #2695 → #2696 |
| **TUI slice 6 plans** (all 5) | seed #2676; intent #2680; plans #2686/#2687/#2688/#2689/#2690 |
| **TUI slice 6 impl — waitstate** (remove wait polling + window right-pane detail) | #2691 |
| **TUI slice 6 impl — unattributed** (segment FIFO retention + count label) | #2693 |
| **TUI slice 6 impl — pipeline-steering** (4 subspecs: parser/client/dispatch/docs; approve/reject/resume) | #2698 |
| Operator docs + queue + seeds + spec amendments (#2692, #2697, close) | this session's close PRs |

Notes: every batch-A/premise/waitstate implement settled non-clean and was **hand-finished** — recurring cursor patterns: `idle_output_timeout` after committing the impl but before finalization (fold in the un-committed AC-ticks/fixture-regens, verify, publish); malformed/stray prose `// @mutate` → `contract_miss` (gate-repair); a **hollow** mutation directive that the run never verified because it died first (premise: `if (false) continue` didn't redden — corrected to `if (true) continue`; **always hand-verify the pin reddens**); `.test.tsx`↔`.test.ts` pin extension mismatch (waitstate). CI **now runs `lint:md`** (a plan actuator's nested-backtick MD038 stranded premise's plan). Fanning plan-completion ready-gates ≥4-wide risks flaky full-suite strands (see spec-only-diff seed) — ran slice-6 plans 3-then-2 and they came clean. **Keystone re-scope (post-decision):** a subagent review caught that a hand-verify `git checkout -- write.ts` had discarded the _uncommitted_ re-scope edit (the require-gate was still live; CI red) — **commit before any restore-based hand-verify**, and a green _local_ gate that ran before the clobber is not evidence the _committed_ code is right. Also hit a **GitHub PR-head desync** (branch ref advanced, PR head + CI stuck two commits behind, even after a fresh push) — fixed by `gh pr close` + `gh pr reopen`. **Pipeline-steering hollow (2 attempts) had two independent causes:** multiline `test.each` title resolution (fixed by `mutation-checkpoint-pin-resolution`) AND the criterion not _naming_ its enclosing test (`#2655`, unenforced at plan-draft) — resolution ≠ linking; unblocked by rewriting subspec-00's criterion to be **prescriptive** (exact plain-`test` title + exact directive, #2697). **run-steering** then `iteration_timeout`'d at 45min (single subspec too big) with an impl that failed its own tests — split it (see start-here #1).

## Landed 2026-08-06/07 (queue-drain session — gate-repair + 6 specs)

| Thread | intent → plan → implement PRs |
| --- | --- |
| **`gate-repair-fence`** (base-ref scope, attributable write fence, non-resumable out-of-scope, verified autofix, biome pin) | #2651 → #2654 → #2665 (00/01+02 code) + #2666 (02 mutation+03+05) |
| **`mutation-checkpoint-criterion-enclosing-test-docs`** (authoring rule + runbook + doc-assertion) | #2650 → #2652 → #2655 |
| **`plan-review-hollow-pin-criterion`** (advisory hollow-pin pass in plan debate review) | #2650 → #2653 → #2660 |
| **`pipeline-plan-stage-consumes-ready-intent`** (plan stage deletes its chained ready-intent) | #2658 → #2663 → #2667 |
| **`pipeline-stage-settlement-honesty`** (settlement liveness defer, base retarget, guard deletion) | #2659 → #2664 → #2668 |
| **`intent-landing-accepts-wrapped-prerequisite-bullets`** (block-assembly for prerequisites) | #2657 → #2661 → #2670 |
| **`plan-intent-write-steps-lint-own-markdown`** (staged-md lint before finalize; split) | #2656 → #2662 → #2669 (split) → #2671 |
| Operator docs + queue reconciliation + 2 seeds | this session's close PR |

Notes: GitHub Actions hosted-runner outage all session → every merge on operator-approved local ready gate. gate-repair-fence stranded on the slow-`v1/test/run.test.ts` Problem A it fixes; the completion run finished green but settled `ready_flip_failed` (outage) — hand-published both increments. **#2668 surviving mutation was a real fan-out bug**: `settleFanOutBranch` would skip a still-running live-linked branch's suffix; traced the deferred-adopt trigger (untested by the suite), wrote + hand-verified a pinning test, and resolved a merge conflict with gate-repair (took #2666's settlement-resumable, reverting 2664's scope-creep). **plan-intent-write-steps-lint** timed out one write iteration as a single subspec (claude `iteration_timeout` ~45min ×2) → split into 3; each then finished in one iteration. Operator misdiagnosed two long silent iterations as "saturation" and killed a run — refuted by 18 cores / load ~6 and a sibling flying through 4 subspecs concurrently; the silence was claude-blindness, not contention.

## Landed 2026-08-06 (session — stale-reset sibling + no-hard-wrap)

| Thread | intent → plan → implement PRs |
| --- | --- |
| **`intent-workflow-stale-reset-cli`** (add `intent` to `STALE_RESET_WORKFLOWS`; relocate shared seam; `.jarvis-*` dirty exclusion) | #2637 → #2638 → #2639 |
| **`intent-workflow-stale-reset-pipeline`** (daemon pipeline intent-stage re-dispatch preflight) | #2637 (shared) → #2641 → #2644 |
| **`authored-markdown-no-hard-wrap` prompt** (`global.no-hard-wrap` fragment + AGENTS.md convention) | #2642 → #2643 → #2645 |
| **`authored-markdown-no-hard-wrap` lint** (custom rule + `reflow:md` + 107-file corpus reflow) | #2642 (shared) → #2646 → #2647 |
| Operator docs + queue reconciliation | this session's close PR |

Notes: seed `#2640` for the operator wrapping request. Pipeline implement (#2644) shipped a **production no-op** — the daemon never constructed the injection bundle; the tests injected it directly and passed. A subagent review caught it; hand-wired the real construction + a regression test through the real deps builder, then a 3-lens **review-debate** added fail-open + bounded-read robustness fixes. Both agents hit the deterministic cognitive-complexity wall (`biome-ignore` fix; clean on main). Every mutation-checkpoint criterion was pre-fixed at plan time to name its enclosing `test()` before pin-title authoring guidance landed; that linker gap is closed in this session's close PR (`v1/docs/spec-guidance.md` § Mutation-checkpoint criteria + `v2/docs/operator-runbook.md` § Gate trust). A **GitHub Actions runner outage** forced operator-approved local-ready merges for #2644–#2647. The corpus reflow degraded one malformed table (`write-behavior.md`, missing delimiter row) — fixed; the new rule conflicts with v1's autofix-repair contract (v1 runtime unaffected) — the v1 fixture was made to conform.

## Landed 2026-08-06 (cluster session — implement-blocker cluster)

| Thread | intent → plan → implement PRs |
| --- | --- |
| **`mutation-directive-target-absent-reprompts`** (reprompt in-run instead of hard-block) | #2628 → #2631 → #2633 |
| **`implement-completion-commit-runs-formatter`** (format changed files before staging) | #2627 → #2630 → #2635 |
| **`successor-step-idle-watchdog`** (00 scope-gate + 01 watchdog; `role_stalled` + claim release) | #2629 → #2632 → #2634 |
| Operator docs + queue reconciliation | this session's close PR |

Notes: each seed ran the full intent→plan→implement pipeline (cursor-first, claude fallback). **Formatter (#2635)** — the workflow successor `role_timeout`'d before pushing, so hand-published the clean completion commit; then hand-fixed a **review-caught blocking defect** (the formatter threw on markdown-only / deletion-only changed sets — `bun biome check --write` exits non-zero "No files were processed" — which would have failed **every** intent-split and plan-draft completion commit; added a biome-eligible-paths filter + regressions). Its own completion commit was also unformatted (import order) and hand-formatted. **Successor watchdog (#2634)** — one implement run landed both subspecs; CI-red on a flaky test (a test-fixture defect: `rehydrateReviewPromptProfile` dropped the test's per-step hang override, so the test raced the real subprocess path under CI load) — subagent-diagnosed and fixed by hanging the registry render. **Reprompt (#2633)** — finalization settled `ready_gate_out_of_scope` on slow out-of-scope `v1/test/run.test.ts` under load (see `seeds/gate-repair-fence` Problem A and carried operator notes). 3 subagent reviews; the formatter review caught the real high-blast-radius bug pre-merge.

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
| 1 | `seeds/gate-repair-baseref-probe-runs-scoped-command` | **New** — base-ref probe runs raw `bun test`, not the terminal step's scoped command; completes the gate-repair-fence correctness fix. |
| 2 | `seeds/plan-review-must-falsify-guard-premises` | Extends the verifier bundle 1 rewrote. |

`seeds/tui-waitstate-is-polled-but-no-longer-rendered` rides TUI slice 6.

## Carried operator notes

- **Throttle concurrent implement runs — the cluster session proved it again.** Three implements + their successors running at once saturated the machine; the slow `v1/test/run.test.ts` (>2min under load) then timed out in `#2633`'s finalization gate and settled `ready_gate_out_of_scope`, which no resume could clear (three tried). Run ~2 implements max; stagger; let the machine quiet before a finalization resume.
- **A successor `role_timeout` (or idle stall) can leave the write's work committed-but-unpushed with no PR.** Recovery is hand-publish: push the clean completion-commit `HEAD` (not the dirty tree — a timed-out shrink leaves stranded partial edits on disk that must be discarded, per Gate-trust), open the PR, run CI + a subagent diff review. `#2635`'s formatter did exactly this.
- **Expect to hand-format the completion-commit-formatter PR once.** The run that implements the formatter commits its _own_ change before the formatter is active on that commit, so the formatter PR itself lands unformatted (import order) and fails CI `check`. Run `bun biome check --write` on the changed files and push. (After #2635 ships, future runs format their own commits — this is a one-time bootstrap.)
- **A subagent diff review earns its keep on green CI.** `#2635` was CI-green but the review caught a markdown/deletion-only formatter throw that would have broken every intent/plan completion commit. Never merge an implement PR on green CI alone — the review is the gate that catches what the tests don't exercise.
- **`resetStaleWorkspace` now refuses stale reuse (descendant gate, landed this session).** After merging a subspec increment and re-dispatching for the next, the old worktree is not a descendant of the new base → `jarvis cleanup --abandon <branch> --yes`, then re-dispatch.
- **The daemon auto-bounces to the merged build** (observed loaded→current after each merge); a transient `no daemon is listening` can appear mid-bounce — retry the command.
- **`jarvis cleanup --abandon <branch> --yes`** works non-interactively.
- **`jarvis config set-agents` takes a CSV arg** (`claude,cursor`), not space-separated.
- **A `completed`/`no-work` implement row can have committed nothing.** Confirm by PR, not status.
- **CI now runs `lint:md`** (verified 2026-08-07: a plan-actuator MD038 failed the CI "Lint markdown" job on #2679). You no longer have to run it locally as the last line of defense — but the plan/intent _review actuator_ still edits staged Markdown after the write-step lint without re-linting, so an actuator-introduced violation lands on the branch and fails CI (see `seeds/plan-review-actuator-edits-bypass-write-step-markdown-lint`). Watch reflow/table-heavy and verbatim-backtick criteria.
- **`jarvis run kill` and `jarvis cleanup` are classifier-gated** in auto mode; hand them to the operator's own shell when blocked.
- **`bun run reflow:md` is blind to malformed tables.** The reflow (and the `no-hard-wrap` rule) share one markdown-it view, so a run of `| … |` rows that lacks a `| --- |` delimiter row, or has a paragraph wedged between the header and later rows with no blank line, parses as a _paragraph_ and gets joined into one line. If a reflow diff mangles a table, the source was already malformed (never rendered as a table) — fix the source (add the delimiter row and/or a blank line), do not touch the reflow script. Review reflow diffs on table-heavy docs before merging. First hit: `#2647` on `v2/docs/write-behavior.md`.
- **The `no-hard-wrap` rule applies to v1's `runHarnessMarkdownlint`, but v1's autofix repair cannot satisfy it.** The rule lives in the shared `.markdownlint-cli2.jsonc`, so v1's `intentCommand` markdown repair (autofix-based, `runMarkdownlintAutofix`) is now linted against it — but `no-hard-wrap` is not `markdownlint --fix`-able, so any v1 repair-cleanliness test asserting 0 violations on wrapped input fails. v1 _runtime_ is unaffected (repair is autofix, not a hard gate; it just leaves wrapped prose). Fix the test fixture to conform (single-line prose), do not weaken the rule or exclude v1. First hit: `#2647` on `v1/test/intent-command.test.ts`.
- **`ready_flip_failed` = green run, un-flipped PR — hand-publish.** During the Actions outage, completion runs finished the full ready gate (`runtime_smoke_outcome: observed-clean`) but settled `ready_flip_failed` (the draft→ready flip failed) with no open PR. The work is committed on the branch. Recovery: create the PR by hand, run the scoped local gate + a subagent review, mark ready, admin-merge. Also seen: `idle_output_timeout` / `invalid_token` / `iteration_timeout` successors leave all subspec code committed but the last box un-ticked and no PR — same hand-publish (tick the lagging index box, hand-verify any un-harness-verified mutation checkpoint). First hits: `#2665`/`#2666`/`#2670`/`#2671`.
- **A single subspec can be too big for one write iteration — split it.** `plan-intent-write-steps-lint` (new lint runner + plan + intent gates + prompt + big test file, ~15 files) settled claude `iteration_timeout` at ~45min twice, even solo on a quiet machine (not load). Split into 00 runner / 01 plan / 02 intent (#2669) and each finished in one iteration. When an implement run keeps timing out one iteration, split the spec, don't just re-run.
- **A surviving mutation can be a real bug — dig in before overriding.** `#2668` settled `surviving_mutation_failed` on an operator-flip `=== "running"` at `settleFanOutBranch`; the code was reviewed-correct and 564 tests passed. First hand-assertion attempt did NOT catch the flip (verify your pin!). Tracing the exact trigger (deferred-adopt on a live-linked fan-out branch) exposed a genuine "skip a still-running branch's suffix" bug the suite never exercised. Write the pinning test and hand-verify it reddens; don't merge past the mutation gate on a "probably equivalent" guess.
- **Trust the harness (watchdog included) until proven wrong — don't babysit silence.** The default posture is "the harness works": a run logging only `iteration_started` for a long time is _working_ until the watchdog says otherwise. `jarvis run log` shows lifecycle events, not the agent stream, so a long claude iteration always looks silent there — that is not evidence of a stall. The idle/wall watchdogs already reset on claude's `--include-partial-messages` stream and fire `idle_output_timeout`/`iteration_timeout` on a genuine stall (verified this session: fired on a truly-idle successor, stayed quiet on 45-min streaming write steps). This session an operator killed a working claude run on silence + a "saturation" guess (refuted: 18 cores, load ~6, a sibling flew through 4 subspecs concurrently) and wasted its compute. Don't kill/intervene on quiet; wait for an actual terminal signal (failed/blocked/watchdog timeout) or hard evidence.
- **`bun run lint:md` uses config globs (v2/spec, v2/docs, …), not arbitrary files.** Linting changed files explicitly (e.g. `git diff --name-only | xargs markdownlint`) gives false positives on paths outside the gate's globs — intentional test fixtures under `v2/src/**` and prompts under `prompts/**` are NOT linted by the gate. Verify markdown PRs with `bun run lint:md` (config globs) before merging, not an explicit-file lint.
- **`git pull` before `jarvis cleanup` — cleanup reads local completion state, so a stale local `main` misarchives.** Admin-merging via `gh` advances `origin/main` but only `git fetch` (not `pull`) updates the ref; the local working tree stays behind. Running cleanup then reads stale spec files: it misread two just-merged specs as having unchecked criteria (skipped archiving them) and archived the older ones off stale content, leaving the primary checkout dirty. Recovery: `git stash -u` → `git pull --ff-only` → `git stash drop`, then re-run cleanup on the synced tree. Always `git pull --ff-only origin main` immediately before `jarvis cleanup`. First hit: 2026-08-07 close (local at #2669 while origin at #2671).
