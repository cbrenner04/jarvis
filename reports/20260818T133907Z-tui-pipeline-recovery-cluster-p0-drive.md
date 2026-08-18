# Session report — TUI/pipeline recovery cluster (P0) drive (2026-08-17 → 18)

## Assignment

Jarvis-on-Jarvis operator session (`/remote-control`). Dig into a failed `distinguish-jarvis-commit-steps` implement run, then work `v2/spec/tui-pipeline-continuation-brief.md` — the **P0 recovery cluster** first (the two plan-draft root causes, then the two pipeline-recovery seeds), then the pipeline stack (`configure-pipeline-supersede-policy` → the two fan-out seeds). Push the distinguish spec through as a favor. Codex-first agent order until quota, claude second; cursor/opencode unavailable.

## Outcome (honest status)

**P0 recovery cluster — mostly landed.**

- **Both plan-draft root causes — DONE.** `plan-draft-harness-blocker-survives-redraft` shipped as #2879; `plan-draft-blocker-append-creates-bare-spec-file` as #2888. These are the brief's highest-priority pair — plan re-runs are no longer silently defeated by stale/misrouted harness blockers.
- **`branch-scoped-pipeline-resume` — 3 of 4 layers merged.** state-store reopen (#2880), orchestration (#2889), daemon RPC (#2894). The CLI layer (`expose-branch-scoped-pipeline-resume-cli`) is the last piece — carried over (its plan blocked three times on the normalizer's single-surface check flagging a legit CLI-prints-daemon-reason bullet).
- **`pipeline-stage-recoverable-after-blocker` — 1.5 of 3 layers.** Execution foundation `recover-edited-plan-stage` (#2891) merged; daemon `recover-one-blocked-pipeline-branch-stage` implemented (PR #2895, left CONFLICTING and unreviewed — carry over); operator CLI `expose-pipeline-stage-recovery-command` remains (depends on #2895).

**distinguish (favor) — not landed.** Three implement attempts, all defeated by the spec's **empty/unlinked mutation-checkpoint markers** (`; Keystone checkpoint:` / `; Mutation checkpoint:` with no `@mutate` body) in subspecs 01/02 — a malformed prior-session plan. Failures were `missing_blocker`, then `spec.criteria-ticked` (unlinked), then `iteration_commit_failed`. Deferred: needs a deliberate spec hand-repair (fill or strip the empty checkpoints) before re-running, not more re-rolls.

**Pipeline stack (configure-supersede + fan-out) — not started.** The P0 cluster plus heavy operator-collaboration detours (below) consumed the session.

## Implementation PRs (code)

- #2879 — Clear plan-draft harness blockers before redraft
- #2888 — Route plan-draft contract-miss blockers
- #2880 — Reopen One Failed Pipeline Branch (branch-scoped state-store reopen)
- #2889 — Resume One Failed Pipeline Branch (branch-scoped orchestration)
- #2894 — Accept Branch-Scoped Pipeline Resume RPCs (daemon handler)
- #2891 — Recover an Edited Plan Stage Without Redrafting (stage-recovery execution foundation)

## Plan / intent PRs

Intents #2868–2871 (four P0 seeds → 9 ready-intents); plans #2872, #2874, #2873, #2875, #2886, #2892, #2893.

## Seeds landed

- #2876 — `pipeline-settlement-survives-daemon-restart` (a pipeline whose entry run terminates while the daemon is down wedges in derived `running` with no recovery verb — the wedged `aede4177` v2-init pipeline).
- #2882 — `implement-retirement-destroys-artifacts-before-materialization` + `implement-resumes-stalled-unmerged-subspec-chain` (retirement deletes worktree/branch before validating rematerialization; `--base == <branch>` self-destructs; no clean resume for a stalled manual implement with committed-unmerged subspecs).
- (this close-out PR) — `heavy-daemon-agent-tests-flake-under-ci-concurrency`.

## Operator-collaboration detours (a large part of this session)

- **v2-init branch recovery (my error).** I advised `--base <the-branch-itself>` to resume a stalled manual implement; the preflight retired (deleted) the worktree + local + remote branch, then tried to recreate the branch from itself (`git branch X X`) and failed. Recovered the operator's work from the object store (`git fsck` → `git branch <name> <dangling-sha>`), then twice rebuilt the tangled/rebase-corrupted branch clean onto current main (restoring a dropped `readinessDeps`, a lost cognitive-complexity reduction, and the async-git-runner fix). Delivered as commit `d232efac` for PR #2890.
- **Misdiagnosed the real CI blocker.** Hand-finished PRs red-gated on the `check` job; I first blamed biome `noNonNullAssertion` *warnings* (level `warn`, harmless) and missed the actual errors below them: biome **format**, **cognitive-complexity**, and the **`Bun.spawnSync` guard**. Lesson saved to memory: gate hand-finishes on `bun run check`, not just typecheck + tests.
- **The concurrency flake.** `workflow-runner.test.ts` (agent-test wall-clock timeout) and `daemon-resume.test.ts` (99/0 in isolation, 106 fails run concurrently under load) red-gated roughly half of all PRs; every implement needed CI re-runs. Widened the seed to name the whole class.
- **GitHub incident** mid-session (503s on merges, transient network in CI) — hand-finished around it with retry loops.
- **Digest-socket churn.** Every merge bounced the daemon to a new digest, so `cleanup --abandon` intermittently reported "no daemon listening" until a `run` command re-bounced it — forced a launch-then-abandon dance on each re-run.

## Hand-finishing pattern used

Several implements completed the work (all AC ticked) but hit `iteration_timeout` / `completion_commit_failed` before committing or publishing — claude's one-big-iteration style plus the concurrency flake in the ready-gate. Salvage: commit the uncommitted work in the run's worktree, run `bun run check` (+ `bun biome format --write` for the common formatting miss), push, flip the draft ready, admin-merge on green. Also dropped over-claimed surviving `@mutate` directives (operator chose "drop the honest-but-unpinnable directives" over fixture surgery) on resume and recover-edited to keep checkpoints honest.

## Agents / cost

Codex-first order, but codex hit quota early (implement rung `gpt-5.6-sol` → `claude-sonnet-5` fallback at dispatch); effectively all implement/plan runs ran on claude (not in operator paid cost). Operator model: claude-opus-4-8.

- **Operator cost (claude-opus-4-8):** **$151.20** (148.1k input / 675.9k output / 203.6m cache read / 3.4m cache write; API 2h 46m 54s).
- **Wall clock:** ~1d 14h 36m (2026-08-16T22:00Z → 2026-08-18T13:40Z, with multiple quota-limit pauses within). Code changes: +375 / −62 lines.

## Carry-over for the next session (ordered)

1. **`heavy-daemon-agent-tests-flake-under-ci-concurrency` — implement first.** Highest leverage: it is red-gating the operator's own open PRs (#2884, #2890) and every implement's CI. Unblocks everything downstream.
2. **`recover-one-blocked-pipeline-branch-stage` (#2895)** — rebase (CONFLICTING against current main), review, merge.
3. **`expose-branch-scoped-pipeline-resume-cli`** — hand-finish the plan (normalizer blocked its draft 3×; the CLI-prints-daemon-reason AC bullet trips single-surface enforcement — cross-ref `plan-normalizer-honors-declared-single-surface`), then implement.
4. **`expose-pipeline-stage-recovery-command`** — plan + implement (after #2895 merges).
5. **distinguish** — hand-repair the empty checkpoint markers in subspecs 01/02, then implement.
6. **Pipeline stack** — `configure-pipeline-supersede-policy` (plan; prior plan failed) → the two fan-out seeds.

Operator-owned, untouched: `#2890` (v2-init, my fix `d232efac` handed over), `#2884` (reap chain), the parked pipeline `22041e31`.
