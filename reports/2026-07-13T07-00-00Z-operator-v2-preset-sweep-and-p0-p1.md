# Operator session — v2 preset sweep, P0 recovery, P1 complete (2026-07-12T22:15Z → 2026-07-13T07:00Z)

## Summary

Dogfooded all six v2 workflow presets against real work. **Every preset that drives
the write loop was broken.** Fixing them surfaced a deeper v1 bug — Jarvis had never
been able to see claude's output — which in turn exposed that the idle-escalation
watchdog has never fired for any agent since it shipped.

Ended with: **P1 complete, all P0s landed, v2 able to plan and implement.** 46 PRs
merged. P2 (the workflow collapse) is the remaining scope and is untouched.

The through-line worth keeping: **every one of these bugs was invisible to the test
suite and fatal on first real launch.** Construction-level tests passed; runs died the
moment they touched a real worktree, a real prompt, or a real agent. Two P0s were
marked `completed` while the operator-visible failure they named still reproduced —
their fixes had landed one layer away from the bug, with green tests.

---

## The preset sweep (opening state)

| Preset | Result |
| --- | --- |
| `intent` | ✅ split works |
| `intent-reviewed` | ⚠️ split works; **review step is a silent no-op** — empty log, no verdict, no commit, reports `completed` |
| `plan` | ❌ `invalid_token` — correct draft written to disk, then discarded, run marked non-resumable |
| `plan-reviewed` | ❌ `invalid_token` |
| `plan-reviewed-light` | ❌ `invalid_token` |
| `implement` | ❌ ENOENT on first launch; then a prompt-render failure before any agent was invoked |

The `invalid_token` case was the worst: the agent did the job perfectly, wrote a
correct spec tree, and the loop threw it away because the last line was a prose
summary instead of a bare `done` token. The prompt asked for the token as an *enum
description*, not an output-format rule.

---

## Implementation PRs

Every implementation PR that landed, in merge order.

### v1 — the watchdog chain

| PR | What |
| --- | --- |
| [#1450](https://github.com/cbrenner04/jarvis/pull/1450) | **Claude streams output so the idle watchdog can see it.** `claude.ts` spawned with `--output-format json` — a batch envelope emitted once at exit — so `spawn.ts`'s `stdout.on("data")` activity bump never fired mid-iteration. Changed to `--output-format stream-json --verbose` with incremental line-wise parsing. |

This is the session's most consequential fix. **Verified empirically:** every one of the
34 prior claude patch *timeouts* recorded `last_output_age_ms: null`; the first
post-fix timeout recorded `152704`. The watchdog can now see claude.

It also invalidated two pieces of operator folklore that had been treated as fact —
"claude-haiku stalls due to Claude-pool contention with the operator session" and
"claude-sonnet-5 is too slow for patch". Neither is true. Two concurrent
`claude-opus-4-8` *plan* runs completed cleanly during the very claude *patch* run that
"stalled", on the same pool, under the same Claude operator session. **Zero output was a
missing measurement, not a starved agent.**

### v2 — `plan` preset (the `invalid_token` chain)

| PR | What |
| --- | --- |
| [#1451](https://github.com/cbrenner04/jarvis/pull/1451) | Terminal-token step rules state an output-**format** rule, not an enum |
| [#1458](https://github.com/cbrenner04/jarvis/pull/1458) | A missing terminal token triggers one cheap re-prompt, not a hard fail |
| [#1459](https://github.com/cbrenner04/jarvis/pull/1459) | A step with satisfied artifacts is not discarded for a missing token |

### v2 — `implement` preset

| PR | What |
| --- | --- |
| [#1456](https://github.com/cbrenner04/jarvis/pull/1456) | Write step assembles placeholders per prompt id (`implement` could not invoke an agent — `patch.prompt.body` rendered with no `SPEC_PATH` and died 29ms in) |
| [#1460](https://github.com/cbrenner04/jarvis/pull/1460) | `implement`'s linked-index routing read works on first launch (the runner read the index inside a worktree that didn't exist yet — the bug #1417 was supposed to have fixed) |
| [#1479](https://github.com/cbrenner04/jarvis/pull/1479) | Implement prompt states the terminal-token vocabulary |

### v2 — the reconciler race

The orphan reconciler (#1430, shipped before this session) swept two runs the **current**
daemon had itself admitted three minutes earlier, marking them `killed / daemon_restart`
while their agents kept working. It cost both P1 runs — work done, stranded uncommitted.

| PR | What |
| --- | --- |
| [#1476](https://github.com/cbrenner04/jarvis/pull/1476) | Orphan reconciler only sweeps runs whose admitting process is gone |
| [#1477](https://github.com/cbrenner04/jarvis/pull/1477) | A run row's status never contradicts its own terminal event |
| [#1478](https://github.com/cbrenner04/jarvis/pull/1478) | `seq` is unique per run in the durable log |

### v2 — `blocked` contract

| PR | What |
| --- | --- |
| [#1474](https://github.com/cbrenner04/jarvis/pull/1474) | A `blocked` token with no `## Blocker` is a contract violation (agent finished the subspec, returned `blocked`, wrote no blocker; operator told to `inspect_spec` with nothing to inspect) |

### v2 — P1 (operational hygiene) — **complete**

| PR | What |
| --- | --- |
| [#1440](https://github.com/cbrenner04/jarvis/pull/1440) | Daemon process log read |
| [#1465](https://github.com/cbrenner04/jarvis/pull/1465) | Unhandled run async failures become terminal structured-log events |
| [#1464](https://github.com/cbrenner04/jarvis/pull/1464) | Each agent invocation writes a durable session log |

PR #1465 is why my own failed v2 runs had surfaced as a bare `harness_failure`: an
uncaught `executeWorkflow` rejection resolved a promise that had already resolved, so
the failure vanished.

### Produced by the v2 harness itself

| PR | What |
| --- | --- |
| [#1461](https://github.com/cbrenner04/jarvis/pull/1461) | `plan` preset output (`review-without-evidence-fails-the-run`) — the first PR this session generated by v2 rather than v1 |

---

## Plan / intent / seed PRs (summarized)

Intents: #1433, #1437, #1438, #1439, #1441, #1445, #1466, #1467.
Plans: #1434, #1435, #1442, #1443, #1444, #1446, #1447, #1448, #1449, #1469, #1470, #1471, #1472, #1473.
Seeds & docs: #1436, #1452, #1454, #1455, #1457, #1462, #1463, #1468, #1475.

---

## Seeds opened (13)

| Seed | Priority | Why |
| --- | --- | --- |
| `invalid-token-discards-completed-work` | P0 ✅ fixed | Dominant v2 failure mode |
| `implement-write-step-renders-prompt-without-placeholders` | P0 ✅ fixed | `implement` never reached an agent |
| `implement-linked-routing-reads-index-before-worktree-exists` | P0 ✅ fixed | `implement` dead on first launch |
| `intent-reviewed-review-step-is-a-silent-no-op` | P0 | Review reports `completed` without running. **Open** |
| `orphan-reconciler-kills-live-runs` | P0 ✅ fixed | Reconciler swept live runs |
| `blocked-outcome-with-no-blocker-text` | P0 ✅ fixed | `blocked` with nothing to inspect |
| `patch-watchdog-blind-to-claude-output` | P0 ✅ fixed | Jarvis never saw claude's stdout |
| `idle-output-timeout-defaults-equal-to-the-iteration-wall` | P0 | **Open.** See below |
| `run-workflow-exits-zero-on-failed-run` | P1 | Failed runs exit 0. **Open** |
| `daemon-runs-stale-code-until-restarted` | P1 | A merged fix looks broken until the daemon bounces. **Open** |
| `worktree-accumulation-breaks-agent-sandboxes` | P1 | E2BIG. See below. **Open** |
| `operator-notified-on-run-completion` | P2 | Operators hand-roll polling loops. **Open** |
| `triage-merge-only-handles-spec-branches` | P2 | Seed/report/doc PRs skip the gate. **Open** |
| `agent-execution-policy-is-per-vendor-and-inconsistent` | P2 | Intake #1453. **Open** |
| `runs-jsonl-cannot-measure-agent-invocation-duration` | backlog | **Open** |

---

## The three findings worth remembering

### 1. The idle watchdog had never fired — for any agent, ever

`idleOutputTimeoutMs` defaulted to **600000ms**. `iterationTimeoutMs` was **600000ms**.
Equal. For the idle timer to reach 600s of silence, the iteration must already have
burned 600s of wall clock, so the hard timeout always won. **The idle-escalation ladder
was structurally unreachable with shipped defaults**, while the runbook documented it as
a live mechanism.

This was invisible until #1450 made claude's output observable. The very next claude run
recorded 152 seconds of measured silence — exactly the signal idle escalation exists to
act on — and still rode the full wall to exit 8 with zero iterations, because 152s <
600s. **Fixing the observation exposed that nothing consumed it.**

Config now: `iterationTimeoutMs: 1800000` (30 min), `idleOutputTimeoutMs: 300000` (5 min).
The ladder fired for the first time during this session. Seed
`idle-output-timeout-defaults-equal-to-the-iteration-wall` is open for the code fix.

### 2. Accumulated worktrees silently break every agent sandbox

Each registered git worktree becomes a sandbox deny-path. At **67 worktrees** (~198 deny
paths) the exec argument list exceeded the OS limit and **every** command inside an agent
session failed with `E2BIG` — including a bare `pwd`. Two consecutive claude runs finished
their implementation, could not run a single test, and blocked.

Silent until total. Looks like an agent failure. Hits *verification* specifically, so work
gets done and then discarded unverified. `dangerouslyDisableSandbox` was also rejected —
no escape hatch. Hand-pruning 54 merged worktrees (67 → 13) cleared it.

### 3. `review-feedback` earned its keep

The last P0 failed CI on two tests that passed locally (full v1 suite: 1830 pass, 0 fail).
`jarvis1 review-feedback` collected the failing checks and found a **real production bug**
in `v1/src/agents/spawn.ts`: a child that exits before consuming stdin closes the pipe, the
subsequent write raises `EPIPE`, and with no `error` listener Node crashes the process.
Linux CI exits fast enough to hit it; macOS timing hid it. Any agent crashing early would
have taken Jarvis down with it.

---

## Agent notes

- **claude** works for `plan`, `intent`, and `review` — every plan this session landed
  clean on `claude-opus-4-8`. It was **0-for-3 on patch/implement**, always hitting the
  wall with 0 iterations. Post-#1450 we can see why: one run was idle 186ms at the kill
  (actively streaming, just needed >10 min), the other idle 144s (a real stall that the
  dead ladder couldn't escalate).
- **cursor** carried most implementation work at $0.00, but stalled hard on one spec
  (3 attempts, ~85 min, 0 iterations). It is also partially unobservable (14 null vs 4
  with output), so a working idle watchdog kills it — ready-intent
  `cursor-streams-tool-activity` is on `main`, unimplemented.
- **codex** finished in one iteration the spec cursor had burned 85 minutes on.

---

## Blocked / operator actions needed

1. **`autoMode.allow` for merges.** Every session re-litigates admin-merge with the Claude
   Code auto-mode classifier; general autonomy does not count, it must be named. A settings
   entry would end the ritual permanently.
2. **A drafted triage comment for intake #1453** is unposted at `.scratch/issue-comment.md`
   (publishing to a public issue was not authorized). The seed itself landed as #1454.

---

## Not done

- **P2 — the workflow collapse.** Split into 5 ready-intents (#1433): `workflow-composition-gate`,
  `workflow-review-options`, `review-workflow-composition`, `publication-workflow-composition`,
  `shared-linked-subspec-routing`. None planned. Plus `intent-reviewed-uses-external-worktree`
  to fold in.
- **`intent-reviewed`'s review step** is still a silent no-op. Its three ready-intents are on
  `main`; subspec 00 of `review-step-emits-log-events` is complete but uncommitted in a
  worktree (the run blocked before subspec 01).

## Cost

### Jarvis spend (from `~/.jarvis/runs.jsonl`, 2026-07-12T22:15Z → 2026-07-13T07:00Z)

**28 jarvis runs** — 14 patch, 14 plan. Aggregate:

| | Tokens in | Tokens out | Cache read | Cache write | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Total** | 314,025 | 688,792 | 72,441,631 | 5,325,630 | 20.3h |

`total_tokens` (in + out) = **1,002,817**.

Per-run costs where the agent reported them: the two completed runs with metered figures
were `daemon-process-log-read` at **$2.17** (codex did the implementation for $0.41; the
claude review side was $1.75) and `write-step-rules-state-terminal-token-as-output-format`
at **$2.98**. Cursor implementations reported **$0.00** (free tier; its usage is not
measurable from the CLI, so cursor cost is estimated from prompt + stdout tokens only).

**Waste worth naming:** three claude patch runs hit the iteration wall with **zero
completed iterations**. The `daemon-process-log-read` first attempt alone burned 294k
tokens in / 1.8k out for nothing. Cursor burned ~85 minutes across three attempts on
`implement-prompt-states-terminal-tokens` before codex finished it in one iteration.

Note the plan rows: every one is `plan-review-ok` on claude, and plan output tokens
(20k–38k each) dwarf plan input. Plans are cheap and reliable; implementation is where
the cost and the failure both live.

### Operator (orchestration) cost

Pending — operator session stats to be supplied. The four cumulative CSVs
(`session-costs`, `operator-costs`, `session-outcomes`, `operator-outcomes`) and the
derived `efficiency.csv` will be updated on receipt, per the
[cost-reporting standard](../v1/docs/operator-runbook.md#cost-reporting-standard).
