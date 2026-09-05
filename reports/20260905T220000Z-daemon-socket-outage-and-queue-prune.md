# 2026-09-05 — the harness deleted its own daemon socket, and a queue prune

Operator-present session. Most of it went to an outage that made Jarvis unusable across every registered project. The fixes are the session's real output; the planned parallelization and pipeline-dogfood work happened around them.

**16 PRs merged.** Full list at the end.

## The outage

`startIpcServer` ran an unconditional `rmSync(socketPath)` before binding — code dating to #729. Every daemon start unlinked whatever was at the path, including a healthy daemon's live socket. And *every* `jarvis` command auto-starts a daemon when it cannot reach one, so the failure was self-perpetuating: each stranded command started a daemon that deleted the socket again. 16 orphaned processes and 242 logged `EPERM`s accumulated before the mechanism was understood.

The shape is nasty because the daemon keeps working. It holds the bound inode and serves established connections, but `connect()` resolves by path, so every new client gets `ENOENT`. `daemon status` reads `stopped` for a process that is fine, and every run it owns becomes unobservable and unsettleable — indistinguishable by CLI from the documented deadlock whose recorded recovery is `kill -9`, which here would have destroyed live work in three projects.

**The diagnostic that separates them:** `lsof -p <pid> | grep unix` naming a socket path that `stat` says does not exist. Now in the runbook, along with the live-canary test that rules out a periodic reaper.

Fixed in three layers, because the first two were defeated:

- **#3468** — probe before unlinking; refuse when a peer answers. A probe *timeout* counts as live, since a saturated daemon is still serving.
- **#3469** — stop short-circuiting on `existsSync`, which false-negatives when the caller cannot stat the path.
- **#3471** — the one that closed it: unlink only a **proven-stale** entry. Under the sandbox agent sessions run in, `connect()` to a *live* socket returns `ENOENT`, which #3469 still classified as `absent` and removed.

The generalizable rule, now in the brief: **a guard that decides whether to destroy something must treat every inconclusive answer as "do not destroy."** `ENOENT` from a caller that cannot see the path is inconclusive, not authoritative. Both failed attempts made the same mistake in different clothes.

**#3473** fixed the signal that made this take three attempts. `startDaemon` wrote the pid file at spawn, so a start that never bound overwrote a healthy daemon's pid with one that never served — observed live: pid file `75064`, daemon actually serving `74393`. `getDaemonStatus` then short-circuited on that pid regardless of whether the socket answered. The socket is the service, so it decides now; the pid is gone from the signature.

## Two chess-blocking bugs, same class

**#3480**, both reported by the operator as recurring:

1. `worktree spec unreadable` for a spec that reads fine. The landed-criteria gate reads specs at `join(worktreePath, relative(projectRoot, absPath))`, which only works inside the project root. A chained fan-out lane's spec lives in the *prior stage's* worktree, so the relative path escaped as `../../.jarvis/…` and resolved nowhere. Deterministic — the lane was permanently unresumable, and the operator's only workaround had been discarding the whole pipeline, losing intent and plan work across every lane.
2. `completion_publication_missing_pr_evidence` over a published PR. Settlement read PR evidence from the entry run alone, while publication dispatches late under its own run id and records it on a **successor** row. Two independent occurrences in one session, two projects: jarvis PR #3475 on sibling `da9e1262`, chess PR #55 on sibling `c7d3d2cf`.

Both are the outage's class: something recorded by one layer, resolved by another under a different assumption. Notably, (2) **refutes the `pipeline-settlement-derives-from-run-rows` seed's own stated fix** ("rebuilt from the durable entry row"), which would reproduce the bug; corrected in #3478.

## What the gates could not catch

**#3483** landed the external-admission foundation — the prerequisite chain for #3374 and the operator's homestead pipeline. Independent review caught a HIGH bug before publication: external seeds and ready-intents were **never consumed**. Both landings recorded `sourceRoot: project.root` while the input lives under `~/.jarvis/specs/<safeId>/`, so the consumer's containment check skipped every one silently — no unlink, no error, no log. The queue would never drain and each run would re-split the same seed.

The existing tests could not have caught it: they assert the step *field* (`landing.inputs`), never driving the consumer. One asserted `sourceRoot: root` outright — pinning the bug. **A test that asserts a recorded field is not a test that the behavior happens.**

**#3482** fixed a flaky test failing CI on every code branch: `state-store-wal-concurrency` slept a fixed 100ms for a subprocess to take a lock, then asserted the writer waited >400ms. When `bun --eval` startup exceeded the sleep there was no contention at all (`Received: 123`). Docs-only branches skip the test slices, which is why `main` looked clean while code branches failed.

## Pipeline dogfood

`full-review` on `pipeline-resume-echoes-pipeline-id-on-success` ran **clean end to end** — intent → approve → plan → approve → implement — survived the outage sitting at a gate, and resumed without intervention (#3481). Its plan draft was the counter-example to plan-invention: all five acceptance criteria named tests that verify as present.

It then produced the session's most valuable failure. The implement stage published PR #3475 and wedged; `pipeline resume`, run exactly as the runbook prescribes, settled the stage **`failed`** with `completion_publication_missing_pr_evidence` — over an open, non-draft PR on that very branch. That is how bug (2) above was found.

## Queue prune

Audited all 53 seeds, 29 ready-intents, and 26 open issues against `main`, verifying by artifact rather than name (#3488). Reaped 9 seeds and 3 ready-intents; **108 items → ~78**.

**Two audit claims failed verification and were rejected** — recorded because this is the failure mode the repo keeps hitting:

- "`ready-finalize.ts` no longer exists, so the `JARVIS_READY_TIER` runbook bullet is wrong" — the file exists and line 973 still stomps the key. Bullet stays.
- "the watchdog `.unref()` already landed" — not present. Seed stays open.

Two entries are now time-critical, both raised to P0:

- **`importer-cap-counts-realized-not-surface-total` is a dated fuse.** The cap is 200; `v2/src` holds **165 test files**. At 200 the v2 mutation gate fails surface-wide for every implement.
- **`structural-invariant-locator-loud-failure`** is the only schedulable item in a five-deep chain — `shared/structural-test-locator.ts` does not exist, and four `*-anchors` intents plus the docs lane declare it a prerequisite. Its plan landed (#3487); the audit doc it builds on landed as #3485 (115 rows: 113 behavioral, 98 re-key, 8 stay-incidental).

**Seeded the CPU-orphan mode (#3489)**, which had **no owner**: the runbook cited a seed reaped when #3431 landed only the gate-group half, and no ready-intent or issue covered the rest. Three sibling spawns still record no process group.

## Operator lessons

- **Cleanup finishes only half its job, in two distinct ways.** It archives spec trees on disk but leaves the moves uncommitted (#3491), so `main` still carries them as open and the next cleanup re-surveys them. And it cannot retire a worktree whose work was published under a different branch name — a direct cost of the `salvage/*` workaround used whenever force-push is blocked.
- **Per-branch fan-out gates make a dependency chain look like independent approvals.** Approving five unblocked lanes at once dispatched four plans against unmet prerequisites. Approve the head, land it, then resume.
- **Attribute by parentage before concluding anything about concurrency.** An orphaned `nohup` loop of mine ran 15 minutes against the very slice I was measuring, producing a "pre-existing on `main`" conclusion CI then contradicted. `nohup` inside a tool call escapes to `launchd`; the harness's tracked background mode does not.

## Agent attribution

**102 role invocations, $14.11 agent cost, 4.4 agent-hours** — 101 cursor/Composer 2.5, 1 claude/sonnet-5. Codex remains out of the order at the operator's instruction.

## PRs

- Outage and fixes: [#3468], [#3469], [#3471], [#3473], [#3480], [#3482]
- Feature and salvage: [#3481], [#3483], [#3484], [#3485], [#3487]
- Queue and bookkeeping: [#3470], [#3474], [#3476], [#3477], [#3478], [#3486], [#3488], [#3489], [#3490], [#3491]

## Open at close

- `home-win-rate-display` (chess) needs a daemon bounce onto this build, then `jarvis pipeline resume a00ca258-… home-win-rate-display`. Chess PRs #52–#55 are open and mergeable; #55's work was complete all along.
- `inject-daemon-write-loop-binding-deps` remains unlanded from an `iteration_timeout`.
- `pipeline-resume-plan-lane-owns-preamble` subspecs 01–02 remain.
