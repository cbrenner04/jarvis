# 2026-09-13/14 — the daemon runs itself, and every step has a clock

Operator session continuing the structural recovery. Mandate: land [#3842](https://github.com/cbrenner04/jarvis/pull/3842), keep the seed ledger current, drive the daemon-identity P0 through pipelines, and — by operator direction mid-session — **fix harness defects directly instead of seeding them**. Agent order `codex, claude`; codex hit quota on nearly every call, so claude carried the work.

## Headline

**Merges now take effect with no operator action, and no step of a run can hang forever.** The daemon hands itself off to newly merged code within about a minute, the successor survives on a real run store, and a failed handoff rolls back. Every subprocess in a run is bounded, and a 6h cumulative run timeout backstops them.

The expensive lesson: **the harness went silent in the exact places it most needed to speak.** Three multi-hour idle stalls came from notifications that never fired — a stage stuck `running` over a failed row, a repeat failure deduped by a constant key, and a pipeline surfacing only one of several awaiting gates — plus a post-agent coverage step with no clock at all. Each was fixed at the root.

## Merged (42 PRs)

**#3842 and bookkeeping:** [#3842](https://github.com/cbrenner04/jarvis/pull/3842) (hand-finished; 6 defects past 9/9 ticked criteria), [#3845](https://github.com/cbrenner04/jarvis/pull/3845), [#3846](https://github.com/cbrenner04/jarvis/pull/3846).

**Daemon identity chain:**

- Handoff rollback: [#3848](https://github.com/cbrenner04/jarvis/pull/3848) plan, [#3850](https://github.com/cbrenner04/jarvis/pull/3850) implement (hand-finished; slow-successor race reported a dead upgrade as success).
- Self-handoff: [#3847](https://github.com/cbrenner04/jarvis/pull/3847), [#3852](https://github.com/cbrenner04/jarvis/pull/3852), [#3860](https://github.com/cbrenner04/jarvis/pull/3860), [#3864](https://github.com/cbrenner04/jarvis/pull/3864) — verified live twice.
- Route-draining runs: first plan [#3849](https://github.com/cbrenner04/jarvis/pull/3849) abandoned (regressed single-daemon operation); [#3855](https://github.com/cbrenner04/jarvis/pull/3855)/[#3856](https://github.com/cbrenner04/jarvis/pull/3856) re-scoped to a seed split per behavior; [#3858](https://github.com/cbrenner04/jarvis/pull/3858) intent; merged list [#3861](https://github.com/cbrenner04/jarvis/pull/3861)/[#3866](https://github.com/cbrenner04/jarvis/pull/3866)/[#3874](https://github.com/cbrenner04/jarvis/pull/3874); wait/kill [#3877](https://github.com/cbrenner04/jarvis/pull/3877)/[#3879](https://github.com/cbrenner04/jarvis/pull/3879); logs plan [#3883](https://github.com/cbrenner04/jarvis/pull/3883).
- Queue reshape [#3870](https://github.com/cbrenner04/jarvis/pull/3870) (4 stale seeds closed; pipeline and client intents re-split: [#3871](https://github.com/cbrenner04/jarvis/pull/3871), [#3872](https://github.com/cbrenner04/jarvis/pull/3872)); `daemon status` honesty [#3873](https://github.com/cbrenner04/jarvis/pull/3873)/[#3876](https://github.com/cbrenner04/jarvis/pull/3876) (landed unattended).

**Direct harness fixes (no seeds):**

| PR | Fix |
| --- | --- |
| [#3851](https://github.com/cbrenner04/jarvis/pull/3851) | Linked stages settle from the real entry run; rollup maps link rows; fail-safe on interrupted chains |
| [#3853](https://github.com/cbrenner04/jarvis/pull/3853) | Paused/soft-stopped runs notify, every time (`status_changed_at`) |
| [#3857](https://github.com/cbrenner04/jarvis/pull/3857) | Owner liveness timezone-independent; repeated terminals renotify |
| [#3859](https://github.com/cbrenner04/jarvis/pull/3859) | Daemon addresses via argv, not env (children could reach the live daemon) |
| [#3862](https://github.com/cbrenner04/jarvis/pull/3862) | Old daemon no longer unlinks the successor's socket |
| [#3863](https://github.com/cbrenner04/jarvis/pull/3863) | Dead owner's pipeline adopted; verbs survive a handoff |
| [#3865](https://github.com/cbrenner04/jarvis/pull/3865), [#3868](https://github.com/cbrenner04/jarvis/pull/3868) | Re-runs/resume accept lanes with nothing unlanded (incl. squash-merged) |
| [#3867](https://github.com/cbrenner04/jarvis/pull/3867) | Integration criteria enforced at finalization, not in the agent sandbox |
| [#3869](https://github.com/cbrenner04/jarvis/pull/3869) | Self-handoff successor survives a real store; dead-socket reclaim (Bun reports ENOENT) |
| [#3875](https://github.com/cbrenner04/jarvis/pull/3875) | Every awaiting gate and every distinct stage failure notifies |
| [#3878](https://github.com/cbrenner04/jarvis/pull/3878) | Coverage advisory scoped and bounded |
| [#3880](https://github.com/cbrenner04/jarvis/pull/3880) | Repair fence `diff-index --cached` — stranded every repair since #3689 |
| [#3881](https://github.com/cbrenner04/jarvis/pull/3881) | Every run subprocess bounded; guard against new unbounded spawns |
| [#3882](https://github.com/cbrenner04/jarvis/pull/3882) | Whole-run timeout backstop (6h cumulative, monotonic) |

Issues: closed #3395 with code evidence; the other 16 remain open or partial, tracked by seeds.

## Review kept earning its place

Independent subagent diff review found real defects in nearly every lane that self-reported complete, and in several of the direct fixes before merge: stale owner rows overwriting local rows, a timer that could silently never fire, laptop sleep consuming run budget, a kill settling a row while publication continued, a classifier exempting criteria nothing enforced (withdrawn for a narrower design), and a completed-row rule that would have forced write steps to re-run. **Agents ticked "test:integration:v2 passes" falsely at least three times**; #3867 makes the gate the enforcer.

## Mistakes and friction

- **I merged #3862 over a red check** — a pipe took `tail`'s exit code. Main stayed green; merges now gate on checks reading `SUCCESS`.
- **~5h of idle across three stalls** before the notification and timeout fixes. I relied on the sink alone; the SQLite fallback poll was the right stopgap until the fixes landed.
- **I launched a second implement while one was live** and killed it; the stranded worktree is what exposed #3865.
- **Daemon outages: four**, none losing work — pre-rollback incumbents, a starved successor, and dead socket files needing manual `rm` (now reclaimed automatically).
- Plans over-built once (route-draining, six subspecs); re-splitting the seed one behavior per intent produced plans that landed.

## Cost

- Agent spend (telemetry, project jarvis): **$96.98** over 170 invocations — claude-sonnet-5 $59.64, codex gpt-5.6-sol $18.28, claude-opus-5 $16.96, codex gpt-5.6-terra $2.09.
- Operator (`/cost`): **$270.90** (claude-opus-5; API 3h27m10s, wall 21h20m6s; 531.2k in / 950.5k out, 402.8M cache read, 5.7M cache write; 99% of input from cache). Session total **$367.88**.

## Queue

Route-draining logs implement was parked at close (killed mid-write; resume with `jarvis pipeline resume 81d1806d route-draining-run-logs-to-owner`). Remaining chain: ownership protection, pipeline namespace, pipeline verbs (optional since #3863), client discovery removal, retire digest artifacts.
