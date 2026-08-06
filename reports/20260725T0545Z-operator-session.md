# Operator session — 2026-07-25 (P0–P1, then a fix batch)

38 PRs merged. All of the P0 and four of five P1 chains from `.scratch/2026-07-25-spec-priorities.md` reached implementation-complete. Mid-session the operator reprioritized: defects found while driving the queue were seeded and run ahead of the remaining backlog. Next-session ranking: `.scratch/2026-07-26-spec-priorities.md`.

## Implementation PRs

| PR | What | Agent |
| --- | --- | --- |
| [#2119](https://github.com/cbrenner04/jarvis/pull/2119) | State-store copy/remove include WAL sidecars | cursor |
| [#2121](https://github.com/cbrenner04/jarvis/pull/2121) | Write-loop iteration wall extends on output, hard ceiling | cursor + claude |
| [#2122](https://github.com/cbrenner04/jarvis/pull/2122) | Resume after state-store lock timeout preserves committed write | cursor |
| [#2123](https://github.com/cbrenner04/jarvis/pull/2123) | TUI live terminal window and workflow collapse (**P0**) | cursor |
| [#2137](https://github.com/cbrenner04/jarvis/pull/2137) | A ready-gate timeout kill is not a red gate | claude |
| [#2141](https://github.com/cbrenner04/jarvis/pull/2141) | Surviving mutation settles a failed row from any step | claude |
| [#2145](https://github.com/cbrenner04/jarvis/pull/2145) | Review-role wall clock is a configured value | claude |
| [#2148](https://github.com/cbrenner04/jarvis/pull/2148) | Plan workflow defaults to one debate review pass | cursor |

Plans: #2115, #2117, #2118, #2120, #2124, #2129, #2131, #2132, #2143, #2147. Intents: #2127, #2128. Config: #2133, #2135. Docs: #2139. Seeds: #2125, #2126, #2134, #2136, #2138, #2140, #2144. Hand recoveries: #2116, #2130, #2142.

Open and blocked: [#2149](https://github.com/cbrenner04/jarvis/pull/2149) — see below.

## The session's main finding

**The ready gate's shared wall clock was manufacturing phantom red gates.** `scripts/ready.ts` spends one 10-minute budget across every step (`remainingMs = deadlineMs - elapsedMs`), the aggregate suite alone takes ~9 minutes, and the flake-retry re-runs the whole test step from that same budget. A flaky file at minute 5 leaves the retry 5 minutes to do a 9-minute job, so it is killed, exits `124`, and the implement run records `ready_gate_repair` with `gateExitCode: 1` — handing the repair agent a failure that never existed. The same gate re-run by hand on an idle machine at the same commit passed green.

Cost on one spec: two ~12-minute repair iterations against correct code. #2137 fixes the laundering; per-step budgets are queued (`ready-gate-per-step-budgets`).

Tests are **not** CPU-saturating — `run-v2-tests.ts` runs one file at a time via `spawnSync`. The gate is latency-bound. Concurrency makes the deadline likelier to bite; it was never the cause.

## Agent/model findings

**`claude.implement` was the only role on haiku.** Every other claude role ran sonnet-5 or opus-5. Implement — write the change *and* tick its criteria — had the cheapest model in the file. Fourteen cursor implements: zero contract misses. Five claude/haiku implements: two contract misses, both with substantial correct code on disk and **zero** criteria ticked. Raised to sonnet-5 (#2133).

**The review actuator was deterministically dying at its wall.** Two consecutive dispatches ended `dur=600131` and `dur=600123`, `exit_code:-1`, while adversary/advocate/adjudicator finished in 30–135s. Not slow — over-bounded: actuator median is 88s (4th fastest of eight roles) but its max is exactly the wall. `implement` does comparable diff-scaled work at p90 760s / max 4741s against a far larger budget. Two fixes: rung order corrected to sonnet-first (#2135), which took the actuator to a 548s pass; and the bound made configurable at 1_800_000 ms (#2145). `roleTimeoutMs` had been declared on three types and forwarded once but **never set anywhere**, so every review role silently inherited `write-loop.ts`'s `DEFAULT_ITERATION_TIMEOUT_MS`.

**Plans ran unreviewed all session.** All ten plan runs invoked exactly one role and no plan PR carried a verdict doc, while intent runs showed `critic` + `actuator`. `intent` and `implement` review by default; `plan` did not. Fixed at the close (#2148).

## Recurring taxes

**Intent finalization failed 6 of 8 times.** The split completes, review roles all report `exit_kind: "ok"`, and the intents sit uncommitted in `.jarvis-intent-stage/` while the run settles `failed`. Recovered by hand three times (#2116, #2130, #2142). Seeded and split into three intents (#2128).

The seed's suspected cause — publication gated on `completionAgent`, so an approving critic verdict skips landing — is **refuted** (#2144): the actuator ran `exit_kind: ok` in all seven runs, failures included. Two runs six minutes apart under identical conditions went opposite ways; staged-file count does not separate them. The discriminator is unknown and the intent now carries an instrument-first decision.

**`blocked` / `contract_miss` implements leave real work on disk with zero criteria ticked.** Three this session. Re-dispatch needs `--reset-despite-dirty`, which discards it.

## Corrections made during the session

- **"Config changes need a daemon restart"** — wrong. Newly-admitted runs picked up the new rung on
  the same unrestarted daemon; only a run re-dispatched from a persisted write snapshot replayed the
  old binding. Seed corrected and renamed (#2140) to
  `persisted-snapshot-replays-a-stale-agent-binding`. That narrower defect is real and bites exactly
  when an operator changes a rung to fix the failure being retried.
- **The runbook's "stopping the daemon orphans every in-flight run"** — stale, predating
  reconcile-and-resume. Corrected (#2139). No run was orphaned by a restart all session; the four
  `unsupported_resume_context` rows were review steps with no write snapshot.
- **"Three implements contract-missed"** — it was two.
- **`ps ax -o args= | grep -c '[d]aemon-entrypoint'` returned 5 on a machine with 2 daemons.** The
  session-start "1 daemon" reading was unreliable; use the process list, not the count.

## Live deadlock reproduced

`jarvis daemon stop` refused (`active durable runs: 3ec2402b`) while `jarvis run kill 3ec2402b` refused the same run (`run_not_active`) — nothing could clear it. This is `wedged-workflow-kill-needs-a-live-stall-signal`, still blocked on the idle-stall signal from the write-path watchdog. The daemon lifecycle itself behaved correctly: supersede worked, and the superseded daemon exited on its own once its run settled.

## Blocked

[#2149](https://github.com/cbrenner04/jarvis/pull/2149) `resume-admits-every-row-it-calls-resumable` — two from-scratch implement attempts failed CI identically on `lint/complexity/noExcessiveCognitiveComplexity`: `composeRunOperatorError` at 26 (max 24), plus import ordering. The plan's own decision (reorder the function so a resumable finalization `loop_finished` outranks attempt detail) pushes an at-limit function over, and no decision authorizes an extraction. Amend the spec with an explicit extract-a-pure-helper decision before re-running; the gate-repair loop did not fix it and a third re-dispatch will not either.

## Friction not seeded

- `jarvis config set-agents` takes a **comma-separated** list; space-separated silently prints usage
  and changes nothing. Adjacent to `set-agents-accepts-any-string-including-flags`.
- The runbook's `role_timeout` recovery says re-dispatch "sweeps the actuator's partial edits into
  the next completion commit". It does not — the dirty-worktree gate refuses first, and
  `--reset-despite-dirty` discards them.
- My own: a background waiter grepped only for failure strings, so a **passing** gate looked
  identical to "still running" and it spun 34 minutes. Filters must match success and failure.

## Verification

Every implementation PR got an independent subagent diff review with guard mutation, on top of the harness review step. #2137 ran with `--review-passes 0` (the only such run) because the opus actuator was deterministically walling; its review killed 5/5 mutations. Reviews caught: a false prerequisite that would have stranded the TUI implement, a duplicate ready-intent that would have been planned twice, a backwards doc claim in #2137, and the missing `onOutputProgress` coverage that the mutation verifier had flagged on #2121.
