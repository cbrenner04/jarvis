# 2026-09-04 — the notifications chain closed, and what silence costs

Operator-present session. **17 PRs merged**, plus the `--project` link in its publication tail at writing.

The named ask was `notifications-filter-by-project`. It landed as a four-link chain, and the session's other findings mostly came from being forced to diagnose why each link kept not landing.

## The chain

| Link | PR | Note |
| --- | --- | --- |
| Delivery ledger persists incident JSON + query API | [#3443](https://github.com/cbrenner04/jarvis/pull/3443) | Hand-finished from a false `ready_gate_out_of_scope` |
| Sweep actually writes `incident_json` | [#3446](https://github.com/cbrenner04/jarvis/pull/3446) | The plan caught this; without it the feature returns nothing |
| Daemon `notification_wait` / `notification_list` | [#3450](https://github.com/cbrenner04/jarvis/pull/3450) | 4/4 subspecs |
| `jarvis notifications wait\|list` | [#3455](https://github.com/cbrenner04/jarvis/pull/3455) | **The session's only fully clean run** |
| `--project` filter | plan [#3456](https://github.com/cbrenner04/jarvis/pull/3456), implement in tail | 12/12 criteria authored |

**The plan stage found the defect that would have made the whole feature inert.** `deliverIncident` recorded ledger rows without `incident_json` at both call sites, while the query merged the night before filters `WHERE incident_json IS NOT NULL`. `notifications wait|list` would have been working RPCs over a permanently empty table — a failure with no error anywhere. It was not in the ready-intent; the plan agent noticed the deferral had become a blocker and added a subspec for it.

**A review finding two links back paid off at the end.** The #3443 review-debate flagged "cursor paging without `deliveredAt` in results — real consumer gap". #3450 accordingly returns `{incident, deliveryCursor}`. The `--project` plan then uses exactly that: on a non-matching incident, advance `--since` to the returned cursor and re-arm. Without the earlier catch the last link would have had nothing to page with.

## Parallelism: the answer is the plan stage

The session's parallelization question resolved on the first dispatch. A `plan` run for link 2 was fired deliberately while its prerequisite was mid-implement; it settled `blocked` in ~4 minutes with an accurate blocker naming the missing `StateStore` query.

`jarvis run workflow plan` has **no `--base`** — it always resolves the repository default branch, so it can never see a prerequisite in flight on another branch. Seeded [[plan-bases-off-a-declared-prerequisite-branch]] ([#3437]): give plan the `--base` that `implement` already has.

This is the same mechanism as the existing [[pipeline-fan-out-lanes-serial-chained-bases]] seed, which covers the pipeline-internal case. **Together they are the structural answer to "parallelize all workflow stages"** — nothing can be planned against work that has not merged, so an N-link chain costs N serial round trips no matter how much machine is available. Both seeds share the chaining seam and would be cheaper done together.

Third live evidence arrived the same day: a `full-review` pipeline fanned the structural-invariants seed into **six hard-coupled lanes** forming a strict dependency DAG. Per-branch gates allowed a better response than the runbook's blanket reject — approve only the dependency root, leave the rest `awaiting` — but the five blocked lanes remain blocked for the same reason.

## Two false diagnoses of my own, both corrected

**I claimed `ready_gate_pgid` had never been recorded across 4,002 runs.** Every project showed zero. The claim was wrong: the gate clears the pgid in a `finally`, so the column is non-null *only while a gate runs*. An all-null snapshot at rest is what a correct implementation looks like. I sampled at rest and asserted the stronger claim; the operator was about to act on it.

**I proposed jarvis should reap orphaned `xcodebuild` trees.** The operator pushed back — a harness should not kill processes it did not spawn. Checking showed chess's `readyCommand` *is* `make test`, so those were jarvis's own gate children; but the simulator services beneath them are **launchd-spawned** and structurally outside any process group jarvis can signal. The operator's original instinct was right, and the fix belongs in the project's Makefile.

Both errors share a shape: a confident story built on one snapshot. That is now four times across two sessions.

## The machine was the dominant cause of "trouble" all day

Five orphaned `xcodebuild -scheme ChessPractice` trees, four of them **14 hours old**, every one parented to `launchd`, collectively holding **2,823 iOS runtime processes**. Load oscillated 19 → 556; the process table hit 6,300 against a 10,666 user limit.

Killing the five `make` roots took the tree from 3,932 processes to 706 and iOS runtime to zero.

Retroactively this explains most of the day's failures across all three projects: a `ready_gate_out_of_scope` naming three files that pass 129/0 in isolation, `intent-command.test.ts` CI timeouts with zero real assertion failures, and runs starved into `iteration_timeout` with nothing to show. The chess PR bug and the prose-parser bug were real and independent; the *volume* was environmental.

**Attribution, not counting, is what found it** — five of six `make` roots had `launchd` as parent while only two chess runs were live. A process count would have shown "busy machine" and stopped there.

## `missing_blocker` is one class with four mechanisms

Every one settles `missing_blocker` → `paused` → `unsupported_resume_context`, **non-resumable**, over complete committed work. Two surfaced today on unrelated projects.

| Mechanism | Source |
| --- | --- |
| Blocker appended in an **earlier iteration**; before/after diff scoped to the settling invocation | issue #3029 |
| Blocker exists only in an **uncommitted** worktree | runbook, run `4bfca748` |
| `blocked` **matched in prose** — classification spurious | seed [#3448], **hit twice in one spec today** |
| Chained stage writes to the **prior stage's** worktree; contract arms only on an implement-worktree path | seed [#3452], hit today |

The prose case is structural, not bad luck: a spec implementing notification *kinds*, one of which is named `run-blocked`, is guaranteed to trip a parser that scans response text for the word. Both occurrences were on `daemon-notification-wait-and-list`, subspecs 00 and 02, both complete.

Proposed on #3029: ask "does a non-empty `## Blocker` exist in the spec this run is routing, in any tree it legitimately writes to?", settle a diagnostic naming *where it looked* when not, and stop making `missing_blocker` non-resumable — in all four variants a human can see the blocker plainly.

## Operator-reported bug, fixed by hand

`Confirmed PR number 32 does not match expected number 27` blocked the chess pipeline three times. `findMatchingPr` selects a PR by number with a **state filter**; `confirmPr` then re-resolves with `gh pr view <branch>`, which honors **no** state filter and can answer a different PR.

Evidence was decisive: of ~20 branches in that repo, `intent/04-persistence-and-resume` is the only one with two PRs (#27 MERGED, #32 CLOSED) and the only one that fails. Resetting `main` cannot help — PR history attaches to the branch *name*.

Fixed in [#3449] by confirming by number. The killing test reproduces the operator's exact error string against pre-fix code. **Cause of the repetition:** running the same pipeline repeatedly reuses the same seed slug, so the same branch accumulates PRs; homestead never hit it because it does new work each time.

`gh pr ready <branch>` resolves by branch the same way and is left tracked by the existing `implement-publication-reuses-closed-same-branch-pr` seed.

## Cleanup had been broken for two days

`jarvis cleanup` archived nothing, skipping every spec with `another materialized worktree owns this spec` — including specs whose worktrees had just been retired in the same invocation.

Cause: `.scratch-merge-base-test`, a leftover worktree from 2026-09-03 in **detached HEAD** at a commit already on `main`. Stranded archival fails closed when a same-project managed worktree has an unresolved or detached branch, and **that check is not scoped to the spec being archived** — one detached checkout disabled archival repo-wide. Removing it archived six specs immediately ([#3453]); open spec dirs 18 → 12.

## A circuit-broken lane is indistinguishable from debris

`20260902T035310Z-retire-jarvis-write-command` sat two days: one commit / 16 files ahead of `main`, **0 of 12 criteria ticked, no PR**, while `jarvis write` was still live. Identical in shape to the four genuinely-superseded worktrees retired beside it.

Independent review found the code correct and complete; it was hand-finished in ~20 minutes and landed as [#3445]. A blanket `cleanup --abandon` sweep at close — the normal ritual — would have destroyed it. Seeded [[abandon-refuses-unlanded-work-with-no-pr]] ([#3437]): refuse when a branch has commits not on base and no PR, with `--yes` **not** bypassing it.

The only thing separating valuable from disposable was `git rev-list --count origin/main..<branch>` plus reading the commit.

## My own spec shipped a broken script, green

The narrowed audit spec's subspec 00 completed with all 8 criteria ticked and a discovery script selecting **29 of 183** files against a measured ~65. Two bugs, both the defect the audit exists to catalog: a literal-path check that missed every computed-path read (`readFileSync(sourcePath, …)`, the ordinary style), and a registry-mirror pattern anchored on an exact `BASELINE$` suffix that missed `..._BASELINES`.

**My acceptance criteria are what let it pass** — they exercised synthetic fixtures with literal paths, so a script failing on every real corpus file was green. Fixed to 69 in-scope with a corpus-level regression ([#3447], unmerged — see below).

## Issue state

All 22 open issues triaged against `main` with per-row confidence ([#3454], `reports/20260904T195501Z-issue-state.md`). Ordered by operator cost. Findings that change scheduling:

- **#3039 likely already fixed** — the step-config stamp is workflow-agnostic at the shared front door. Verify-and-close.
- **#3368 half fixed** — sweep bounded and measured; `daemon-lifecycle.ts:294` still hardcodes a 1 s health timeout, so a busy daemon still reads `stopped`, the half that invites `kill -9` on a shared daemon. Rescoped, deliberately not closed.
- **#3026 verified live** — `workflow-loader.ts:56` reads only the top-level `agents` key; the docs' per-project claim is wrong as wired.
- **Three issues are the same machine-global-only shape** (#3026, #3150, #3039) — one override seam closes two.
- **Six of 22 settle with a successful-looking signal while losing work** — the brief's opening class, in the tracker.

## Handoff

- **[#3447] unmerged.** Correct and locally gated except a full-aggregate pass that died three times on `v1/test/intent-command.test.ts` timeouts, zero real assertion failures each time. Wants one quiet full-suite run and an admin merge. Subspecs 01–04 of that spec are unstarted — the lane was stopped before it built inventories on the incomplete manifest.
- **Five structural-invariant lanes** sit at `awaiting` gates on pipeline `a86ed9e6`, blocked on independent bases. Their ready-intents are on `main` ([#3438]).
- **Chess `make test` is red on a pre-existing `StockfishIntegrationTests` crash**, which will block the `make test` criterion on every chess lane until fixed. Not a jarvis defect.
- **Simulator cleanup belongs in chess's Makefile** — launchd-spawned services escape any process group jarvis can signal.

## Agent attribution

**57 jarvis invocations, all cursor, 55 `ok` / 2 `error`, $7.46 list price.** Codex remains out of the order (quota-exhausted since 2026-09-02); the operator confirmed keeping it out. No quota exits observed.
