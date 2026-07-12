# Operator report — v2 dogfooding (2026-07-12)

Session driven from an owner brief of four loosely-specified complaints about v2.
All four are addressed; three blockers *not* in the brief were found by trying to
use v2 to fix v2, and two of those had to be fixed before the brief could proceed.

- **Specs driven:** 14 (13 completed, 1 blocked)
- **Seeds authored:** 8
- **Jarvis spend:** $89.06 (operator-driven) · **Operator session:** $120.90 · **Total: $209.96**
- **Wall:** ~14h · **Operator API time:** 1h09m

## The brief, and what shipped

### 1. `intent-reviewed` fails silently with git-enabled external worktrees

Confirmed and fixed. `buildReviewedIntentWorkflowSteps` derived the review step's
`cwd`, `verdictPath`, and `stagingDir` from `splitStep.worktree.projectRoot` — the
operator's checkout — while the split step wrote into `~/.jarvis/worktrees/…`.
Two consequences worse than the reported symptom: boundary enforcement snapshotted
the **operator's own repo** and could `restoreWorkingTree` it (i.e. revert real
work), and the resulting `intent: .jarvis-intent-stage is missing` was dropped
because `ReviewStepOutcome` had no error field — hence "silent."

**[PR #1380](https://github.com/cbrenner04/jarvis/pull/1380)** — mirrors
`resolvePlanReviewCwd`, threads `jarvisRoot` (which the intent write step, unlike
plan's, never set — a naive copy would have resolved to the real `~/.jarvis` in
tests), and propagates the landing cause.

### 2. PRs need proper titles and descriptions

Both shipped. Titles: **[PR #1381](https://github.com/cbrenner04/jarvis/pull/1381)** —
the publisher now takes workflow-supplied metadata instead of hardcoding
`jarvis: complete run`. Descriptions:
**[PR #1403](https://github.com/cbrenner04/jarvis/pull/1403)**.

The description work correctly *blocked* on the title work at plan time
(`Completion publisher metadata injection is unconfirmed`), so it was parked and
replanned once #1381 landed. Visible proof it works: PR #1405 came out titled
`intent: plan-prompt-done-token-contract`.

### 3. The TUI is useless

Three of four shipped:

- **[PR #1398](https://github.com/cbrenner04/jarvis/pull/1398)** — color on status/liveness
- **[PR #1401](https://github.com/cbrenner04/jarvis/pull/1401)** — *the colors didn't actually render*; see below
- **[PR #1400](https://github.com/cbrenner04/jarvis/pull/1400)** — active runs sorted first
- **[PR #1404](https://github.com/cbrenner04/jarvis/pull/1404)** — terminal-run retention (the "cleanup" the owner was unsure about)

**Not shipped: row keybindings.** Spec merged, three consecutive iteration
timeouts (cursor ×2, claude ×1), worktree abandoned. It is the one piece of the
brief still open.

On retention, the owner's open question was resolved as **daemon-side**: `list`
bounds terminal runs (50 newest) while every non-terminal status stays exempt, so
`jarvis run list` benefits too and the TUI stays a pure renderer. The spec also
caught an unnoticed performance bug — `list` did a `loadRun` plus full log-replay
`tail` *per row*, unbounded, polled at 1 Hz by the TUI.

### 4. The ready gate blocks the entire daemon

Confirmed live: caught `bun run ready` (PID 64318) holding the daemon ~6 minutes
while `jarvis run list` sat blocked behind it. The cause was broader than the gate:
the daemon hosts every run **in-process on one event loop**, and `bun run ready`,
`git push`, `gh pr create`, `gh pr ready`, and even `isWorktreeDirty` on the
`revise` RPC handler were all `execFileSync`.

Five PRs:

- **[PR #1394](https://github.com/cbrenner04/jarvis/pull/1394)** — daemon run Git work
- **[PR #1408](https://github.com/cbrenner04/jarvis/pull/1408)** — completion publication
- **[PR #1407](https://github.com/cbrenner04/jarvis/pull/1407)** — worktree/admission Git
- **[PR #1422](https://github.com/cbrenner04/jarvis/pull/1422)** — the ready gate itself, plus a guard script wired into `check` that fails the gate if anyone reintroduces a synchronous child process in `v2/**` or `shared/**`

The guard immediately earned its keep: it flagged `shared/markdownlint-repair.ts`,
which v2 reaches via `shared/intent-stage.ts` → `validateIntentStage` **inside the
daemon during intent landing**. Sync `markdownlint` had been blocking the daemon on
every v2 intent run.

## Blockers found by dogfooding (not in the brief)

### v2's plan workflow never spawned an agent

`plan-reviewed-light` logged `iteration_started` and then nothing — forever. No
agent process, no timeout, unkillable (`run kill` → `run_not_active` while `list`
said `in-progress`/`live`), and it leaked its worktree, which then squatted on the
`plan/*` branch name and made `jarvis1 plan` fail outright. Reproduced serially and
4-way concurrent. Root cause: the plan write step **threw** before invoking an
agent, and `executeWrite` swallowed the throw.

**[PR #1395](https://github.com/cbrenner04/jarvis/pull/1395)**. After it landed the
run got as far as writing a full spec tree — then failed `invalid_token` because
the plan prompt lacked the write-loop file-output/done-token contract (the same bug
already fixed for `intent` in `b1c42ce3`). **[PR #1410](https://github.com/cbrenner04/jarvis/pull/1410)**
fixed that.

**Consequence for this session: every implementation ran on `jarvis1`, not v2.**

### The daemon threw away its own output

`startDaemon` bound stdout *and* stderr to `/dev/null`. When a run wedged there was
no evidence anywhere; diagnosing the plan stall required `lsof` on the daemon PID.
This is the honest answer to the owner's "couldn't get logs, tui, nothing."

**[PR #1393](https://github.com/cbrenner04/jarvis/pull/1393)** — durable rotating
`~/.jarvis/daemon.log`. Fixing this first is what made everything after it cheap to
diagnose; the `invalid_token` root-cause above took about a minute because the log
existed.

### v2 `implement` cannot launch at all

Only discovered because the owner asked, near the end, whether *any* of this had
gone through v2 implementation. It hadn't — I had switched to `jarvis1` wholesale
when plan broke and never re-tested implement. It rejects every spec at preflight
(`invalid_params: ENOENT`), resolving `--spec` against a worktree it hasn't created
yet. Seeded; the owner took the fix
(**[PR #1417](https://github.com/cbrenner04/jarvis/pull/1417)**).

**Lesson:** I generalized "plan is broken" to "v2 is broken" and stopped testing.
Intent worked the whole time; implement was broken in a completely different way.

## Gate blind spots (the theme of the session)

Three separate times, a run reported success over code that was actually red:

1. `intent-reviewed` exited `criteria-complete (exit 0)` with `test:v2`
   deterministically failing. `triage --merge` caught it independently.
2. The TUI color work shipped **fully green and rendered no color** — every TUI test
   substitutes its own `Text` and asserts on element props it built itself, so the
   production `loadInkUi` seam (which dropped the `color` prop) was never exercised.
   Fixed by hand at owner direction with a test that drives the real seam
   (**[PR #1401](https://github.com/cbrenner04/jarvis/pull/1401)**).
3. The capstone run exited `criteria-complete` with a red suite; its completion gate
   had been killed by the 10-minute watchdog and the run landed anyway.

These are almost certainly **one bug**: the completion gate rides the watchdog
(existing v1 seed `completion-ready-gate-rides-watchdog`), gets killed, and the
shrink → review → final-ready recovery path lands the run without a green gate.
Late in the session `bun run ready` also reported green twice on trees CI then
rejected — same family. Seeded as `local-gate-green-while-ci-red`; the owner has
taken `run-cannot-report-complete-over-red-gate`.

## Toil (candidates for the next round of seeds)

- **The slice-boundary roster broke 4 PRs.** `test/test-slices.test.ts` pins the
  integration file list as a hardcoded array, so every branch adding a
  `*.sandbox-unrunnable.test.ts` must hand-edit it, and parallel branches invalidate
  each other on merge. Caught nothing but its own staleness, every time. Seeded
  (**[PR #1418](https://github.com/cbrenner04/jarvis/pull/1418)**).
- **Hand integration-merges ×3** (#1408, #1410, #1422) — the async conversions all
  touched the same `execFileSync` call sites.
- **v2 reclaims nothing.** Leaked worktrees, branches, and specs accumulate;
  `jarvis1 cleanup` can't see `~/.jarvis/worktrees/`. Seeded (`v2-cleanup-command`).
- **Six orphaned runs** sat `in-progress`/`not-live` across daemon restarts and had
  to be cleared by hand-editing `~/.jarvis/state/v2.sqlite`. Since v2 hosts runs
  in-process, a restart kills them all — so any non-terminal row at startup is
  orphaned by construction. Seeded (`daemon-reconciles-orphaned-runs-on-start`;
  owner has taken it).

## Cost

| | Amount |
|---|---|
| Jarvis (14 specs: plan $36.66 + run $52.40) | **$89.06** |
| Operator session (opus-4.8 1M) | **$120.90** |
| **Total** | **$209.96** |

The operator loop is 58% of spend — consistent with prior sessions. The most
expensive single spec was the capstone at $13.23 (plan $3.93 + run $9.30), of which
roughly **$8 was wasted**: the first attempt came in at 31 files because it wired
the guard as a *new step* in `scripts/ready.ts`'s shared command list, invalidating
~11 v1 ready-step expectations. Abandoned, spec amended to compose the guard into
`check`, re-run clean at 27 files with `scripts/ready.ts` untouched. Catching that
before merge was the right call; not catching it in the spec was the miss.

`tui-row-navigation` cost $3.06 (plan) and delivered nothing.

## Open

- `tui-row-navigation` — spec merged, unimplemented (the last piece of the brief)
- 5 un-intented seeds; 11 unplanned ready-intents
- v2 `plan` still unverified end-to-end after the prompt fix; v2 `implement` fix is
  the owner's
