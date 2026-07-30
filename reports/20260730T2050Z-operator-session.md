# Operator session — 2026-07-30 (evening)

Surface: v2 (`jarvis`). Agent order: **cursor first** throughout, per operator direction.
Window: 15:49Z–19:54Z agent activity; ~5h wall.

## Headline

**The per-project-pipelines phase is complete.** Slices 5 and 6 both shipped, so
`jarvis pipeline start | list | wait | approve | reject | resume` now works end to end and #2352
proves it composes through the daemon. Both carried-over drafts from the prior session
(#2337, #2334) also cleared, emptying the reliability-lane carryover.

## PRs merged (13)

| PR | Work |
| --- | --- |
| [#2334](https://github.com/cbrenner04/jarvis/pull/2334) | `list-row-step-honesty` — carried-over draft |
| [#2337](https://github.com/cbrenner04/jarvis/pull/2337) | `repair-commits-limited-to-run-diff-and-spec-tree` — carried-over draft |
| [#2341](https://github.com/cbrenner04/jarvis/pull/2341) | slice-5 execute — plan |
| [#2342](https://github.com/cbrenner04/jarvis/pull/2342) | two seeds + intent-criterion fix |
| [#2343](https://github.com/cbrenner04/jarvis/pull/2343) | slice-5 execute — implementation |
| [#2344](https://github.com/cbrenner04/jarvis/pull/2344) | `cleanup-eligibility-uses-live-socket-discovery` — plan |
| [#2346](https://github.com/cbrenner04/jarvis/pull/2346) | slice-5 settle — plan |
| [#2347](https://github.com/cbrenner04/jarvis/pull/2347) | `cleanup-eligibility-uses-live-socket-discovery` — implementation |
| [#2348](https://github.com/cbrenner04/jarvis/pull/2348) | slice-5 settle — implementation |
| [#2349](https://github.com/cbrenner04/jarvis/pull/2349) | `exhausted-red-ready-gate-settles-failed-and-resumable` |
| [#2350](https://github.com/cbrenner04/jarvis/pull/2350) | slice-6 proof — plan |
| [#2351](https://github.com/cbrenner04/jarvis/pull/2351) | runbook: `daemon status` after a digest rotation |
| [#2352](https://github.com/cbrenner04/jarvis/pull/2352) | slice-6 end-to-end proof — **phase complete** |

Plus two direct commits to `main` at operator request (`6c6fd8e5` TUI header removal was the
operator's own; `0e3853a7` restored a `cli.test.ts` assertion it had incidentally dropped) and
`047fc117` (slice-6 intent criterion split).

## Recurring defect: mutation verification meets unreachable code

Five of this session's hand interventions were the same shape. A run settles
`surviving_mutation_failed` on a guard that **no test can kill, because the branch is unreachable**.
The fix is deleting dead code, not adding coverage:

- #2337 `pipeline-execution.ts:155` — `index > 0` guarding `ordered[index - 1]`, where `ordered[-1]`
  is already `undefined`. (Killed with a real test instead: an approval stage preceding the pending
  workflow stage.)
- #2334 `daemon.ts:884` — genuinely uncovered; killed with a real test (terminal progress floors
  `attemptCount` at 1; `in_progress` stored unchanged).
- #2343 `terminal-publication.ts:74` — genuinely uncovered; killed with a real test (short gate
  output kept whole, long output truncated to its tail).
- #2349 ×3 — `workflow-runner.ts` 2791, 2795, 3194. All three unreachable: the first two behind a
  checkpoint whose `completionAgent` is a required `string`, the third a disjunct redundant with
  `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS` already containing `ready_gate_failed`. Each fix
  exposed the next one, costing a ~10-minute resume apiece.

Worth noting the pattern for the queue: when a mutation site is a guard on an invariant the type
system already proves, the honest fix removes the guard. Three sequential resumes on one branch is
the tell.

## Recurring defect: plan drafts rejected with an opaque reason

Three plan runs settled `blocked` / `contract_miss` with `failedContractId: "artifact.exists"`,
which reads as "the agent wrote no spec tree." In every case the agent had written a complete,
well-formed tree; `normalizePlanDraftSpecDir` threw a precise error that
`validatePlanDraft` discards in a bare `catch { return false }`
(`v2/src/execution/write.ts:216-224`).

Diagnosis takes one command once you know:

```sh
bun -e 'import {normalizePlanDraftSpecDir} from "./shared/module-boundary-surfaces.ts";
  try { normalizePlanDraftSpecDir("<worktree>/.jarvis-plan-stage"); console.log("OK") }
  catch (e) { console.log("THREW:", e.message) }'
```

Both rejections were multi-surface acceptance bullets (one naming two test files, one naming two
docs). Seeded as `plan-draft-contract-swallows-the-normalizer-reason`; the queue now warns against
blind retries of `guard-bare-settimeout-in-deterministic-tests`, which has burned three dispatches
on this.

## Slice 6 exceeded the iteration ceiling

The final implement ran 45 minutes on a single iteration and settled `iteration_timeout`
(`retryable: false`) with substantial work committed by the per-iteration checkpoint but **zero
criteria ticked**. Hand-finished after the operator asked what that would take.

**I got the assessment wrong first.** I reported all six criteria substantively met and needing
only ticking. `bun test` does not typecheck, so two real compile errors were hidden behind green
tests — a fake `AsyncSubprocessRunner` returning `{stdout, stderr, exitCode}` where the interface
returns `Promise<string>`, and a builders map typed to each builder's real input rather than the
widened map signature — plus biome failures. Corrected and fixed before merge.

Before ticking, the same gates finalization would have run were driven by hand:

- runtime smoke: `observed-clean`
- diff-derived mutation verification: `pass`, 9 candidates across `daemon.ts`,
  `pipeline-execution.ts`, `state-store.ts`
- `bun run test:integration:v2` exit 0; `check`, `typecheck`, `lint:md`, full aggregate `test` green

Both verifiers are exported functions taking `{worktreePath, runBase}`, so hand-running them is
cheap and closes most of the gap that makes hand-finishing risky. The residual gap is that nothing
forces you to do it.

## My errors

- **Merged to `main` four times with three lanes live.** The `jarvis` launcher digests the source
  tree, so each merge rotated the daemon key. `jarvis daemon status` then reported `stopped` while
  the daemon owning the runs was alive on the old key, and I reported the lanes as orphaned. Two of
  the three had already completed normally. Landed as a runbook gotcha (#2351); the existing
  Concurrency guidance already said not to do this.
- **Proposed a seed on that, then withdrew it.** Checked first: PR was not draft, all rows
  `completed`, no run corrupted. It was operator error against documented behavior, so it did not
  meet the seeding bar. One loose thread — a `completed` row with no `loop_finished` record, where
  reconciliation is documented to settle orphans to `killed` — is a single unattributed observation
  and is recorded here rather than seeded.
- **Stacked six redundant background wait loops**, which is what made the fleet look busier than it
  was. Stopped them once the operator flagged it.
- Reported #2347 as "awaiting its finalization flip" from a stale PR listing; it was already ready.

## Agents

**Cursor only, 64 role invocations, zero quota exits** — confirming the operator's expectation that
cursor should not hit quota. 63 `ok`, 1 `error`. Roles: implement 16, plan 7, shrink 5, and 9 each
of adversary/advocate/adjudicator/actuator. Agent wall time 3.6h; agent-side cost **$0.00**
(subscription-billed).

## Hand interventions (10, each a harness gap)

Five mutation-site fixes (above); three merge-conflict resolutions (two cosmetic, one a **migration
id collision** — `018` claimed by two branches, resolved by renumbering to `019` and bumping the
hardcoded migration count, the same trap recorded on 2026-07-30 morning); one CI-only failure (a
submodule working copy with no git identity — green locally because the operator machine has global
git config, red on a fresh runner); one config edit (`terminalAction` added to
`projects.jarvis.pipeline`, seeded).

## Seeds (2 new)

- `plan-draft-contract-swallows-the-normalizer-reason` — three plan runs lost to an opaque
  `artifact.exists`.
- `pipeline-config-validation-blocks-unrelated-implement` — #2336 made `terminalAction` required, and
  a stale `pipeline` block then refused every `implement` dispatch, a path that never reads
  pipelines.

## Cleanup

Five worktrees retired, thirteen merged refs pruned, five specs archived. Zero open PRs, zero live
runs, zero active specs at close.

One worktree retained: `20260727T203911Z-intent-split-prompt-by-surface` holds modified and
untracked files and refuses bulk retirement. It predates this session — inspect before forcing.

## Cost

Operator API: **(pending `/cost`)**. Agent-side telemetry: **$0.00** across 64 cursor invocations.
