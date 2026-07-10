# Jarvis-on-Jarvis Operator Runbook

Reference for the **operator** dogfooding Jarvis on the Jarvis repo itself — driving runs, reviewing PRs, admin-merging, and recovering when gates fail. **Operator** is the single name for this role — older reports and specs may say *overlord* or *orchestrator*; same role, historical.

**Jarvis** is the harness; we currently ship **v1**, invoked as **`jarvis1`** (the `bin/jarvis1` shim). Commands below use `jarvis1`; bare `jarvis` in prose means the harness, not a binary.

Scope: **Jarvis-on-Jarvis only.** An operator driving Jarvis on some *other* repo just runs the prescribed process to land that repo's work and surfaces harness gaps through the [intake](#harness-suggestions-from-other-repos), which the Jarvis-on-Jarvis operator triages.

## Where seeds and intents live

Seeds and ready-intents live under the configured `plan.targetDir`, **not** a fixed
`v2/spec`. The live `~/.jarvis/config.json` currently sets the jarvis project's
`plan.targetDir` to **`v1/spec`**, so the working dirs are:

- Seeds: `v1/spec/seeds/`
- Ready-intents: `v1/spec/ready-intents/`
- Active/completed specs: `v1/spec/<UTC-timestamp>-<name>/` and `v1/spec/completed/`

Genuine v2 planning is the exception: authored with an explicit `--target-dir v2/spec`
override, landing under `v2/spec/`. Check both trees when sweeping the backlog —
`v1/spec` holds the live shipping-surface work; `v2/spec` only the v2-override specs.
Throughout this doc, `<targetDir>` means whatever `plan.targetDir` currently resolves to.

## North star

Touch **only `jarvis1` commands — as few as possible.** Every hands-on step that isn't a jarvis command (resolving a conflict, reconciling an index, restoring a dropped test, manually finalizing, re-running a transient) is a **harness gap**, a seed waiting to be written whose done-state is "a future operator doesn't do this by hand."

But **"fewer manual steps" is not "more commands."** The fix is almost always to fold the behavior into an *existing* command's automatic flow, **not** add a subcommand. New commands are a last resort for a genuinely distinct operator intent. The aim is a **shrinking count of manual interventions per session** — a qualitative read, not a tracked field; not every turn surfaces a gap, so don't force one.

## Log server

`jarvis1 log-server` runs **continuously** on the operator machine (default `http://127.0.0.1:4310/logs`). The operator starts it once and leaves it up across sessions — not per `plan`/`run`, not per agent chat.

**Coding agents:** assume it is already running. **Do not** run `jarvis1 log-server`, kill processes bound to port 4310, or restart the server when `plan`/`run` preflight reports `log server unreachable`. A second instance collides on the port or displaces the operator's long-lived process — agents routinely cause this by treating the preflight error as "server down."

When preflight fails inside a sandbox, the server is usually fine — see [Sandbox blindness](#sandbox-blindness-and-false-negatives) § localhost. Only the operator restarts the log server when it is genuinely down (nothing listening on 4310 outside a sandbox).

## Operator feedback cadence

The orchestration loop (the operator's own model calls) dominates session cost — far above the jarvis runs. So narrate sparingly:

- **Two update points only: when you run a jarvis command, and when it lands.** One line each — name the command/spec when you launch it, name the landed result when it merges. Nothing in between: no "still running" turns, no stage-by-stage narration. After launching background work, stop; the completion notification re-wakes you.
- **After every landed intent (fully implemented and on `main`), give a concise update on the full session** — what shipped, what's still in flight, what's blocked. One short paragraph, not the close-out report.
- **Interrupt only for a decision** you genuinely can't resolve yourself.

## Operator responsibilities (definition of done)

A session is done when the findings and tooling persist, not when the PRs merge. Every session owes:

1. **Drive + review + merge.** Background-run each invocation, poll for state, review each PR, and admin-merge **only** when the diff is correct, in-scope, and leaks nothing sensitive (see [Merging](#merging)). Keep stuck work moving.
2. **Create seeds** in the configured seeds dir (currently `v1/spec/seeds/` — see [Where seeds and intents live](#where-seeds-and-intents-live)) for anything about Jarvis itself that should change — a gap, friction, or improvement surfaced while observing. Seed it; don't just mention it in the report. **If you also work around the gap in the meantime — a runbook caveat and/or a memory — link them both ways so cleanup is obvious when the structural fix lands:** the stopgap names the seed and its **cleanup trigger** (e.g. "delete this once `<seed>` ships"), and the seed's **Documentation updates** section names the stopgap to remove. Operator knowledge lives in this runbook (the operator-agnostic, `jarvis init`-scaffolded home) — a private memory is a personal layer on top, never the system of record.
3. **Triage incoming harness suggestions** into seeds — sweep open issues at [session start](#session-start) and again at close-out. The issue stays **open** until its fix merges.
4. **Write a final report** under `reports/` with a UTC-timestamp filename (e.g. `reports/2026-06-23T00-52-38Z-operator.md`) — date-only names collide. Cover what shipped/merged, workflow/tooling/harness observations, and a cost breakdown (Jarvis spend from `~/.jarvis/runs.jsonl` plus the operator's own session cost) in the [cost schema](#cost-reporting-standard).
5. **Maintain this runbook** directly (branch → PR → admin-merge). Keep it current; batch edits.
6. **Run [end-of-session cleanup](#end-of-session-cleanup)** — `jarvis1 cleanup` to retire merged worktrees and archive specs.

## Runbook maintenance

Post-init, the runbook decays as you learn lessons mid-session without a place to record them. Use `jarvis1 runbook add` to append learnings in place:

```sh
jarvis1 runbook add "A gotcha I just learned"                   # appends to Known gotchas (default)
jarvis1 runbook add --section "Gate blind spots" "Gap in testing"
jarvis1 runbook add --issue-url https://github.com/cbrenner04/jarvis/issues/123 "Fix required for issue #123"
```

**Flags:**

- **`--section <heading>`** — append to a different section. Valid sections: `Known gotchas` (default), `Gate blind spots`, `Cross-repo coordination`. Case-insensitive; heading text without `##`. Invalid sections exit with a list of valid options.
- **`--issue-url <url>`** — optional jarvis issue URL; formats the entry as `- <entry> ([jarvis issue](<url>))`.

**Behavior:**

- Entry text is required and must not be empty or whitespace-only.
- The entry is appended as a new list item at the end of the target section, preserving all other content.
- Running two commands appends two distinct items; no overwrites.
- If `OPERATOR_RUNBOOK.md` is absent, exit 1 and direct you to `jarvis1 init`.
- The new entries commit with the next spec run that touches the runbook, or hand-commit if needed (branch → PR).

## Cost reporting standard

Every session closes four cumulative CSVs (spec rows separate from operator rows). The per-report markdown mirrors only the cost-sheet fields; outcome sheets stay CSV-only.

- **`reports/session-costs.csv`** — one row per Jarvis spec/intent (plan + run phases).
- **`reports/operator-costs.csv`** — one row per operator session.
- **`reports/session-outcomes.csv`** — one outcome row per session cost row.
- **`reports/operator-outcomes.csv`** — one outcome row per operator cost row.
- **`reports/efficiency.csv`** — derived per-report rollup for trend analysis, regenerated from the four source CSVs.

**Sources:** spec/`session-*` figures come from `~/.jarvis/runs.jsonl` (the `namespace`, `mode`, `run_start_ts`/`run_end_ts`, `run_base`, and per-run cost/token fields). Operator/`operator-*` figures come from the operator's own session-cost source, which depends on the CLI the operator drove: Claude Code `/cost` for a Claude operator; the opencode SQLite db (`~/.local/share/opencode/opencode.db`, `session` table — `cost`, `tokens_input`, `tokens_output`, `tokens_cache_read`, `tokens_cache_write`, filtered by session `id`) for an opencode/GLM operator; `opencode stats` gives lifetime aggregates, per-session attribution needs a direct SQL query. `api_time` is blank for opencode (no `/cost` equivalent field). The audit in [outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md) is the authority on which field derives from which source.

**Columns:**

- `session-costs`: `report, name, plan_model, plan_cost, plan_time, plan_tokens_in, plan_tokens_out, run_model, run_cost, run_time, run_tokens_in, run_tokens_out, total_cost, total_tokens, cost_per_1k_tokens, notes`
- `operator-costs`: `report, session, session_count, model, total_cost, cost_per_session, api_time, tokens_in, tokens_out, cache_read, cache_write, total_tokens, cost_per_1k_tokens, notes`
- `session-outcomes`: `report, session_id, report_date, cost, completed_work_units, success_status, failure_reason, session_type, agent_count, duration_minutes, cost_per_minute, files_touched, cost_per_file, notes`
- `operator-outcomes`: `report, session_id, report_date, specs_driven, cost, overall_success, failure_reason, session_type, duration_minutes, cost_per_minute, files_touched, cost_per_file, notes`
- `efficiency`: `report, specs_driven, completed_specs, partial_or_blocked, session_active_tokens, operator_active_tokens, cache_read, observed_cost, paid_cost_only, tokens_per_completed_spec, paid_cost_per_completed_spec`

**Identity & joins:**

- Session cost rows are keyed `(report, name)`; operator cost rows `(report, session)`. The key must be **unique within its `report`** — that uniqueness is what outcome joins rely on. `name`/`session` alone repeat across reports, so never key on them without `report`.
- Outcome rows join to cost rows on `(report, session_id)` → `(report, name)` / `(report, session)`.
- Before writing/amending any outcome row, confirm its `(report, …)` key matches exactly one cost row. A duplicate key within a report is blocking — don't pick one silently.

**Durable bindings** (record in the cost row's `notes`, mirror in the markdown report):

- Patch session row: bind `(report, name)` to one `runs.jsonl` `namespace`, `run_start_ts`, `run_end_ts`, `run_base`.
- Operator cost row: bind `(report, session)` to its exact member `(report, name)` set and shared `session_base`.
- JSONL/derived outcome fields require this binding to exist first; without it, leave the field blank with a note. For the historical header-only outcome sheets, follow [v2/docs/outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md) instead of inventing bindings after the fact.

**Cost-sheet rules:**

- Spec rows: plan + run on one row; `total_cost` = plan + run. `total_tokens` = `plan_tokens_in + plan_tokens_out + run_tokens_in + run_tokens_out`; `cost_per_1k_tokens` = `total_cost / total_tokens * 1000`. Blank columns where a phase doesn't apply (plan-only, blocked-run).
- One operator cost row per session; `total_cost` = the operator's `/cost` total. `total_tokens` = `tokens_in + tokens_out`; cache columns are tracked separately and are not included. A session spanning a compaction boundary (multiple reports, same `/cost`) is one row.
- Dedupe repeated specs across combined reports — one completed row, note the alternate accounting.
- Token columns are raw integers (expand `k`/`M`); costs are dollars; times are `HH:MM:SS`.
- Efficiency rows are derived snapshots. `observed_cost` includes recorded session + operator costs. `paid_cost_only` excludes Cursor/free-subscription rows, includes Claude/Codex/GPT/OpenAI and opencode GLM 5.2 rows, and should be revised if model billing changes.

**Outcome reconciliation** (run after final cost-row reconciliation, before closing the report):

- Write/amend exactly one outcome row per uniquely identified cost row; on rerun, amend — never append a second row. Reconcile pre-existing duplicates back to one row when attribution is certain; otherwise leave the conflict and explain in `notes`.
- Shared fields (`report_date`, `session_type`, `failure_reason`, `duration_minutes`, `files_touched`, `notes`) mean the same on both sheets so rows can union later.
- `cost`: matching cost-row total. `duration_minutes`: plan + run execution time, decimal minutes, 2dp — not the operator `api_time`. `cost_per_minute` = `cost / duration_minutes`.
- `files_touched`: count of distinct changed paths (operator row = whole-session union). `cost_per_file` = `cost / files_touched`; leave blank or spreadsheet-error only when `files_touched` is blank/zero. The operator `session_type` is always `orchestration`.

**Status semantics:**

- `success_status` / `overall_success`: `completed`, `partial`, `blocked`, `canceled`, `failed`, or blank when unknown. `plan-only` is a shape, not a status — record it via cost-row shape, `session_type`, `completed_work_units`, `notes`.
- Exit-derived status/failure are inputs to judgment, not overrides; record the basis in `notes` when judgment differs.
- `completed_work_units` counts delivered **subspecs** — one unit per completed subspec (a single-file spec is one unit). Partial/blocked/canceled/failed still count subspecs done before the terminal state; plan-only = `1` only for a finalized plan. Unknown → blank + note. Blank and failure are distinct.

**Derivation:** use the primary source in [outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md); use a fallback only when attributable to the exact identity being reconciled, else blank + note.

- Patch `report_date`: JSONL run start (never inferred from the cost CSV `report` label). `duration_minutes`: cost-row `plan_time + run_time`. `session_type`/`agent_count`: identity-bound JSONL (`mode`, distinct real agents). `files_touched`: identity-bound run-base git diff.
- Operator `report_date`: earliest matched session outcome date. `specs_driven`: cost-row `session_count`. `duration_minutes`: uniquely matched session-cost rows. `files_touched`: distinct-path union across the bound session set.

## Experimentation — encouraged, but bounded

Improving the harness means experimenting (cheaper agents, model tiering, cost/speed). Within limits:

- **Not at the cost of churn or toil.** Batch tiny PRs; avoid parallelism that creates merge-conflict/reconciliation work; avoid spinning re-runs. Optimization should yield *less* toil.
- **Don't destabilize the harness.** Other repos depend on it — keep `main` green and treat `config.json` (agent order, models) carefully.
- **Pursue cost/speed through sanctioned channels** (model-tiering / codex-cache / transient-backoff intents), not corner-cutting.
- **One-run actuator probes:** use `jarvis1 run --agent`, `jarvis1 plan --agent`, `jarvis1 intent --agent`, or `jarvis1 prompt --agent` instead of editing config `agentOrder` (see [agents.md](./agents.md#per-run---agent-override)).
- **Never circumvent prescribed process.** No hand-implementing specs; they go through plan→run→gate. Hand work is limited to *sanctioned recovery* (below) and must always re-run the gate.

**Observed actuator tiers (2026-06-29, claude-sparing config).** cursor (Composer 2.5) is a solid free primary — plans + implements most specs solo (~$0.03/phase, estimated), but can stall (idle-watchdog exit 8) or blow the 30-min iteration timeout on a complex spec. `opencode/deepseek-v4-flash-free` is **not viable solo** (cascades to cursor for what it can't finish; "unusable" per another repo's operator) — cheap filler only. `opencode/glm-5.2` is a **capable paid escalation** (~$2.50/run metered when opencode reports cost): it solo-completed an impl cursor timed out on. Optional `prices.json` row enables harness cost attribution on estimated-usage and agent-usage-without-cost enrichment. When cursor stalls/times-out on a hard spec, escalate to GLM 5.2. To swap actuators per-invocation without global `config.json` churn, see seed `per-run-agent-override-flag`.

## Harness suggestions from other repos

**Dual audience:** submit path (other-repo operator) and triage path (Jarvis-on-Jarvis operator).

### Submit (other-repo operator)

Hit friction or found a gap? Submit via the intake channel — no Jarvis checkout required.

```sh
gh issue create --repo cbrenner04/jarvis --template harness-suggestion.md   # CLI
```

Or visit <https://github.com/cbrenner04/jarvis/issues/new/choose> and pick "Harness suggestion" (auto-labels).

### Triage (Jarvis-on-Jarvis operator)

One-time prerequisite (once per repo): `gh label create harness-suggestion --repo cbrenner04/jarvis`. Then:

```sh
gh issue list --repo cbrenner04/jarvis --label harness-suggestion --state open
```

If the label is absent, fall back to searching the open-issue list manually. For each suggestion:

1. **Review** and assess whether it's worth a seed.
2. **Seed it** in the configured seeds dir (see [Where seeds and intents live](#where-seeds-and-intents-live)), using the issue content for the problem statement and decisions.
3. **Leave the issue open** and comment referencing the seed (e.g. "Seeded as `<seeds-dir>/<name>.md`"). It stays open until the fix is implemented and merged — the implementation PR closes it via `Closes #N`. A seed is capture, not completion.
4. **Close at triage only when not seeding** — not actionable, duplicate, or out-of-scope — with an explanation.
5. **Operator-error / project-setup is not a harness gap.** If the issue is really an operator mistake or the *target project's* setup (misconfig, missing dep, environment), **respond on the issue** with the cause/fix, **don't seed or change the harness**, and **flag it to the operator**.

**Standing won't-fix:** making `jarvis1 cleanup` archive `commit:false` specs from the external home (intake #566) is **operator-usage, not a harness gap** — the other-repo operator must place specs in jarvis's expected directories. Do not re-seed, re-plan, or re-run it; close any resurfaced copy citing #566.

## Background-run-and-poll pattern

Launch long-running invocations detached so they outlive the shell/turn, then poll:

```sh
nohup jarvis1 run <spec> >run.log 2>&1 &      # human shell
screen -d -m jarvis1 run <spec>
tmux new-session -d -s jarvis "jarvis1 run <spec>"
```

Poll via `tail -f run.log`, `git log --oneline` on the branch, the `index.md` checkbox count, or `~/.jarvis/runs.jsonl` (terminal `exit_reason` rows per `namespace`). Avoid bare shell `&` — the process dies with the shell and runs untracked.

**If the operator is itself an agent** with a background-task runner (e.g. Claude Code's background Bash): launch the jarvis command **as the background task directly** — do *not* nest `nohup … &` inside it. Nesting detaches and returns immediately, so the runner marks the task "complete" while the real run executes untracked (no exit notification).

## Concurrency — avoid cross-run conflicts

- **Don't run two commands that touch the same files concurrently.** Separate worktrees prevent lock contention, but overlapping edits produce merge conflicts later. Sequence runs that share files; merge each as it lands.
- **Throttle `jarvis run` (impl) to ~1–2 concurrent; fan out `plan`/`intent` freely.** Each `run`'s gate executes the full test suite, so 3–4 concurrent runs starve each other's gates and tip timing-sensitive tests over their timeouts — faking `exit 8`/`exit 1` on correct code. (Observed 2026-06-25: 4 concurrent runs, three gate-failed on one flaky test; all recovered by re-running each gate in isolation.) `plan`/`intent` have short gates and isolated spec dirs, so ~3–5 concurrent is fine. When an impl run gate-fails under contention, finalize by re-running its gate in isolation (sandbox-off) on the merged branch — green means contention flake, not bad code.
- **Don't branch-switch the primary checkout while a `plan`/`intent` is starting** — it reads the seed from the primary checkout at startup. Merges and `pull` on `main` (no branch switch) are safe for startup, but see the next point for in-flight runs.
- **Merging anything to `main` during a long in-flight run can leave that run behind base.** When the run completes with all criteria checked, patch-run completion auto-integrates a conflict-free `origin/<base>` merge, runs a post-merge `full` gate, pushes, and flips ready. If integration conflicts or the post-merge gate fails, the PR stays draft and stderr reports `ready flip blocked: branch … does not contain base …; PR stays draft` — hand-run [Integration-merge-then-retest](#integration-merge-then-retest-pattern) for conflicts. Either batch `main` merges for when no run is in flight, or expect manual integration on conflict.
- For operator-side edits (like this runbook) while runs are in flight, work in a **separate worktree**.

## Integration-merge-then-retest pattern

When a PR branched before recent merges (`mergeStateStatus: BEHIND`/`DIRTY`) and patch-run completion auto-integrate did not run or failed (merge conflict, post-merge gate red, dirty pre-merge porcelain):

1. **Trial-merge `main` into the branch's worktree** (`git merge --no-commit origin/main`) and inspect conflicts.
2. **Resolve to keep both works' value** — don't blindly take one side. When two runs solved the same problem differently, merge toward the higher-coverage / more-correct outcome; recover code verbatim from git rather than retyping.
3. **Re-run `bun run test`** (sandbox-off) on the merged tree, confirm coverage didn't regress (below), then commit the merge.
4. Push, `gh pr ready`, admin-merge.

**Watch for silently-dropped tests in refactor PRs.** A "no-behavior-change" refactor can quietly delete or fail to relocate tests. Before merging, diff `grep -c 'test('` across the full test tree (including relocated `*.sandbox-unrunnable.test.ts`) at branch HEAD vs the merge-base; if the count dropped, `comm -23` the sorted test names to see which, and confirm each drop was intentional. Restore unintended drops verbatim from git.

**Two `jarvis1 plan` runs extending the same file's type union (e.g. both adding a step "behavior" to a shared discriminated union) reliably conflict on merge**, not just touch nearby lines — a naive `--ours`/`--theirs` resolution silently drops one side's feature. Delegate the mechanical three-way reconciliation to a subagent (give it both sides' intent and the conflicted files), but **always independently re-verify yourself** before committing: typecheck, `bunx biome check --write`, and the relevant test suites. A subagent's local pass can be correct in substance yet still fail strict CI lint (import ordering, `noExcessiveCognitiveComplexity` after merging two dispatch branches into one function) — budget for 1-2 follow-up fix rounds after the first CI run, not just the initial reconciliation (observed 2026-07-05: `human-loop-behavior` vs `review-debate-behavior` both extending `WorkflowStep` in `workflow-runner.ts`).

## Manual-finalize recovery (last-resort path)

When a patch run (`jarvis run`) ends with a non-success exit reason, the summary includes a `see runbook: OPERATOR_RUNBOOK.md › <section>` pointer that routes you to recovery guidance for that failure reason. The section names match the scaffolded headings in the runbook — follow the pointer to find the recovery steps.

During patch implementation, an idle-output stall (no stdout/stderr and no file activity for `idleOutputTimeoutMs`) auto-escalates through `modes.patch.agentOrder` when fallback rungs remain — same ladder as quota and no-progress. You may see `<agent>: idle timeout; escalating to next agent` before a stronger agent retries the same subspec. Exit `8` on idle abort means the final implementation rung stalled (or a fix-up iteration timed out). The unconfigured `iterationTimeoutMs` wall-clock default is 10 minutes; a normal operation riding that wall is a defect to fix, not tolerated runtime. On the `aborted: iteration-timeout` path (`git: true`, non-external spec), Jarvis commits a `WIP: checkpoint (iteration-timeout)` snapshot of any uncommitted worktree changes before returning — you no longer need to hand-reconcile edits accumulated across repeated iteration-timeouts; they land as WIP commits on the branch.

During review actuator, idle-output stalls auto-escalate through `subRoleAgentOrder.reviewActuator` (falling back to `agentOrder`) when later rungs remain. Stderr shows `review: <agent>: idle timeout; escalating to next agent`. Review actuator terminal idle exits `11` (`review-incomplete`), not `8`. Iteration wall-clock timeout (`iterationTimeoutMs`) on review actuator stays terminal with no ladder advance — do not wait out the wall for idle stalls; idle-fire escalation handles those when configured.

When automated gates fail or are unsafe to re-run, finalize by hand **in the worktree** (the operator is finalizing, not an agent editing mid-run):

```sh
git status && git diff                 # inspect worktree state
# fix issues (lint, types, flakes), then run the gate explicitly:
bun run ready
git add -A                             # caution: absorbs manual commits; Jarvis owns commits here
git commit -m "<message>"
gh pr ready && gh pr merge --admin --squash   # ready first — admin refuses a draft
```

Common cases:

- **Complete-but-dirty run.** All non-human-only acceptance criteria are satisfied but the worktree has uncommitted work — `jarvis1 triage <worktree-name> --mark-ready` auto-finalizes (commit, `-u` push when upstream unset, open draft PR if absent, gate once, ready on green). Refuses when the branch is behind base (`behind base, resolve then re-invoke`); integrate or rebase onto current base first. Never auto-tick criteria.
- **Stuck-red completion (exit 10).** The gate failed repeatedly, fix-up commits were discarded (reset to first-red baseline, force-pushed with `--force-with-lease`), PR left at the original completed work. Recovery: fix the underlying issue. If the gate should now pass, `jarvis1 triage <worktree-name> --mark-ready` re-runs the gate once and promotes on green; on a **clean** worktree, push runs only when `computeUnpushed` > 0 — a branch with `origin` but no upstream and zero detected unpushed commits does **not** get `-u` push (hand-run `git push --set-upstream` if local commits must reach remote first). Otherwise rerun `jarvis1 run <spec>` to retry the fix-up. Discarded edits remain in git reflog. Once the gate is green and the PR is ready, use `jarvis1 triage <spec-path> --merge` (or `jarvis1 triage <pr-ref> --merge`, or `jarvis1 triage <worktree-name> --merge`) to atomically poll CI to green and admin-merge (preferred) or manually `gh pr merge --admin --squash`.
- **Transient-killed plan.** Died on a transient agent-error, leaving a dirty plan worktree. When the review actuator dirtied `intent.md` but left valid subspec edits, Jarvis auto-recovers in the **same** plan review invocation — immediately after the actuator, before commit or phase return — via snapshot revert-and-continue with a stderr notice; do not manually revert `intent.md`. If the actuator finished and only the commit/index-reconcile was lost, reconcile `index.md` to match the subspecs the actuator created, then commit — cheaper than re-running the review. If edits look truncated, discard the bad commit and re-resume (`jarvis1 plan --resume <index.md>`); if the worktree is unsalvageable, `jarvis1 cleanup --abandon <worktree-name>` retires it before re-planning fresh.
- **Flaky parallel-load failure.** Tests that pass serially but fail under `--parallel` are load flakes — `jarvis1 triage <spec-path|pr-ref|worktree-name> --merge` recovers automatically when CI is green at the PR head (it reruns serial `bun test`, then a targeted serial rerun on extracted failing files, and proceeds on a passing probe). If recovery conditions aren't met (CI not green at HEAD, non-test failure, custom `readyCommand`), re-run the failing test(s) in isolation; if green, finalize.
- **CI-only failure (passes the local/jarvis gate).** A path/fs-sensitive bug can pass `bun run ready` under the local `$TMPDIR` layout yet fail **deterministically in CI's `/tmp`**. `jarvis1 review-feedback <worktree>` now collects failing CI check names and per-check excerpts when the PR has red checks but no open review comments, and routes them through the existing feedback loop — try that first. If the feedback rounds are unproductive (~1–2 rounds with no progress), **abandon** the worktree with `jarvis1 cleanup --abandon <worktree-name>` and re-run the spec fresh (`jarvis1 run`) — ideally on a stronger agent — to re-implement from a clean slate. Treat CI as the load-bearing gate for path/fs-sensitive code; a local green alone isn't proof.

Manual admin-merge with `gh pr merge --admin --squash` skips approval and CI verification — always run `bun run ready` before using it. Prefer `jarvis1 triage <spec-path> --merge` (or `jarvis1 triage <pr-ref> --merge`, or `jarvis1 triage <worktree-name> --merge`) instead, which enforces both the local ready gate and CI-green before merging.

## No-commit re-run auto-reset

When a run is interrupted before completion, **Jarvis automatically reverts stale mutations** before the next agent invocation: acceptance criteria ticked in the prior incomplete run are un-ticked, and any appended `## Blocker` is stripped. Pre-attempt checkboxes (authored before any run) stay ticked.

This applies to:
- `git: false` (no-commit) runs in any project
- `git: true` runs where the spec file is external to the agent working tree (outside the repo, so git can't revert it)

In both cases, mutations are untracked and need explicit reversal. For external specs under `git: true`, the operator **no longer reverts checkboxes or strips blockers by hand** — just re-run with the same spec path: `jarvis1 run <spec>`.

## External-spec git-backed re-runs

For external specs authored by `plan.commit:false`, a re-run in normal git-backed patch mode (`git:true`) now does more than the loop-only reset above.

If the spec is still incomplete and the active subspec still has unchecked non-human-only acceptance criteria, Jarvis first resets the source-spec checklist/blocker delta, then treats any prior patch workspace as stale **only when** `.worktree/<spec-name>/.jarvis.lock` is not held by a live process.

On that stale path Jarvis:

- closes the single matching **draft** PR for branch `<spec-name>` when one exists
- refuses cleanup if the matching open PR is ready/non-draft or if multiple open PRs match
- deletes `.worktree/<spec-name>/`, the local `<spec-name>` branch, and `origin/<spec-name>`
- recreates a fresh `<spec-name>` worktree/branch from the current base branch before agent invocation

If any cleanup step fails, the run stops before invoking an agent. This path is specific to external `plan.commit:false` specs re-run with `git:true`; ordinary in-repo resumes still reuse the existing patch worktree/branch, and `git:false` re-runs still do only the source-spec auto-reset above.

## Sandbox blindness and false-negatives

The sandbox (e.g. in Claude Code) can hide real state.

**Per-call bypass is mostly unavoidable here — don't over-invest in allowlists.** The big sandbox-off needs are intrinsic isolation boundaries, not config gaps: the `*.sandbox-unrunnable.test.ts` suite spawns real subprocesses (git, agent CLIs, `gh`), and `ps`/`pgrep` can't see processes spawned outside the sandbox. No allowlist changes either, so `bun run ready` and process inspection run sandbox-off, full stop — the test temp dirs already use `$TMPDIR` (permitted), so the filesystem was never the blocker. A `.claude/settings.local.json` allowlist only helps genuinely filesystem/network-only commands, a thin set here. Reserve `dangerouslyDisableSandbox` for that intrinsic residue. Making `ready` sandbox-aware so the gate stops needing a blanket bypass is a tracked harness improvement — see the `sandbox-aware-ready` seed.

### `ps`/`pgrep` blindness and flag traps

- Processes spawned outside the sandbox are invisible to in-sandbox `ps`/`pgrep`; process inspection **must run sandbox-off**.
- Match on stable command tokens: `pgrep -f 'cli.ts run <spec>'`, not `pgrep -f run`.
- **BSD/macOS `pgrep` has no `-c` flag** (that's Linux). `pgrep -fc …` errors → a `|| echo 0` fallback makes every process look dead. Count with `pgrep -f '<token>' | wc -l`.
- For liveness without process queries, poll the log, `runs.jsonl`, or git history.
- **A gate flake caused by CPU contention may come from an orphaned stray process, not a genuinely concurrent session.** Before assuming a co-running operator/agent is the cause, check `ps aux` for a long-running, high-CPU process whose parent PID is `1` (reparented, its launching shell is gone) — that's a stray left behind by an earlier crashed/abandoned run, not intentional load, and it can pin a full core for hours (observed 2026-07-05: a `bun test` process ran 9-11+ hours at 100% CPU, `ppid 1`). Recovery for the flake itself is the same either way: isolate-retest the specific failing file(s) (`bun test <file>` alone); green in isolation confirms contention, not a regression, and Jarvis's own gate retry/fix-up ladder (or a manual isolated retest plus CI-green confirmation) is sufficient — don't hand-patch code chasing it. Flag the stray process to whoever owns that terminal; don't kill it yourself unless it's clearly yours.

### Localhost/auth/TLS blindness

`gh`/`git` network calls, `localhost` requests, and auth/keychain reads may fail *inside* the sandbox with TLS-cert or permission errors that are **false negatives**. Re-run sandbox-off before debugging — if it succeeds there, the sandbox was the cause.

Specific case: `jarvis1 plan`/`run` aborting with `log server unreachable at http://127.0.0.1:4310/logs` is usually this false-negative — the log server is up ([Log server](#log-server)), but the startup healthcheck's `localhost` request is blocked inside the sandbox. **Do not** restart the log server (you'll hit `port 4310 in use` or kill the operator's process); run the `plan`/`run` **sandbox-off**.

## Merging

`main` enforces branch protection (approval + passing CI, no self-approval); the owner has authorized **admin-merge** for this dogfooding workflow:

**Gated merge path (preferred):**
1. Implementation PRs: spec complete before merge. Plan PRs (`plan/*` head): unchecked subspec AC is OK for `--merge` only (`--mark-ready` still requires completeness).
2. `jarvis1 triage <spec-path|pr-ref|worktree-name> --merge` — runs local `bun run ready`, marks draft PR ready if needed, polls CI green, then admin-squash-merges. Supports implementation and plan worktrees (`plan/*` head). Refusal stderr uses `triage --merge (<class>):` with three classes: `unknown worktree` (resolution failures, including `unknown worktree: <name>` and `unable to get branch name`), `plan PR`, or `implementation PR` (post-resolution). Refuses on gate-red or CI-red with the failing name; PR stays unmerged. Markerless worktrees derive spec from branch name; for `plan/*` branches, the worktree's own target directories are scanned when the primary checkout lacks a matching spec. Merge lands the spec PR only — no `jarvis1 run` or implementation worktree creation.

**Manual fallback (last-resort):**
When `--merge` is unavailable or gates cannot be rerun (e.g., an earlier session ran it and the worktree is gone), finalize by hand:

1. Inspect: `git status && git diff`.
2. Fix issues if needed, then run the gate explicitly: `bun run ready`.
3. Stage and commit: `git add -A && git commit -m "<message>"`.
4. Mark ready and merge: `gh pr ready && gh pr merge --admin --squash`.

Merge **only** when the diff is correct, in-scope, and leaks nothing sensitive. `mergeStateStatus` `BLOCKED` is usually branch-protection only (admin overrides); `DIRTY` is a real conflict to resolve first; `BEHIND` is admin-mergeable.

## The gate

- **`bun run ready`** — the full completion gate. Built-in `ready` is strict verification-only; autofix is configurable via per-project `fixCommand` (default `bun run fix`). On a `full`-tier gate Jarvis runs autofix first (or skips when the resolved package-manager script is absent from `package.json`), commits and pushes any resulting dirty output (message `chore: apply pre-ready check:fix`) **before** verification, then runs strict `ready` (or the project's `readyCommand`) against the committed tree. Autofix and verification are each bounded by `iterationTimeoutMs` (10 min default); hung commands hard-fail with a named message like `bun run ready exceeded 600000ms budget (gate: completion-ready)` instead of hanging. **Prior contract (deliberately changed):** on `full`, green verification with non-empty porcelain used to abort immediately with `ReadyVerificationDirtyError` — repos that treated green+dirty as an abort signal should expect the new norm instead. **Now:** when verification is green and porcelain is still non-empty, Jarvis auto-commits and pushes harness-owned churn (message `chore: apply post-ready verification output`) without re-running verification — mutating `readyCommand` side effects (coverage threshold auto-update, snapshot regen, etc.) are committable on `full`. Residual still-dirty porcelain after that post-verification commit aborts (exit 6) with the same still-dirty template as pre-ready fix commit (commit succeeded, worktree still dirty, inspect unexpected changes) rather than flipping the PR ready. Non-bun repos or repos without a `fix` script must set `fixCommand` in `~/.jarvis/config.json`. The authoritative ready/fix split, gate ordering, and exact step order live in [`v2/docs/v1-behaviors.md`](../../v2/docs/v1-behaviors.md). Jarvis runs the gate on spec completion; the operator runs `ready` before any hand/admin-merge. `jarvis1 triage <spec-path> --merge` (or PR ref / worktree name) runs this gate as the first step before waiting for CI, so both gates are enforced together.
- **`fixCommand`** (per-project, optional) overrides built-in `bun run fix` on `full` gates. Tokenized, no shell. When the resolved command is package-manager-shaped and the script is missing from root `package.json`, autofix is a no-op; verification and commit-if-dirty still run.
- **`bun run fix`** (jarvis repo default when `fixCommand` is unset) expands to `check:fix:unsafe` and is the built-in autofix entrypoint for repos that already define a `fix` script. `check:fix` (safe Biome fixes) still exists as a lower-level script and leaves residual `noExplicitAny`/unused-var/non-null issues; `check:fix:unsafe` applies riskier fixes. `noNonNullAssertion` has `fix: "none"` in `biome.json` — its autofix rewrites `!` to `?.`, which is `T | undefined` under `noUncheckedIndexedAccess` and fails the subsequent typecheck.
- **`bun run typecheck`** is a separate gate (`noImplicitAny` lives in `tsconfig.json`, not Biome).
- Tests that spawn real processes live in `*.sandbox-unrunnable.test.ts` and only run **sandbox-off**.
- **PR CI scopes the test steps inside the `checks` job by changed path** (`scripts/ci-test-scope.ts`): a `v1/**`-only diff runs `test:v1`, `v2/**`-only runs `test:v2` + `test:integration:v2`, `shared/**` runs all three (shared code must satisfy both v1 and v2 callers, so it validates via consumer suites rather than the isolated `test:shared` slice), and root-tooling/unmatched/unresolvable-base diffs fall back to the full `bun run test`. A diff touching only `v1/docs/**`, `v1/spec/**`, `v2/docs/**`, `v2/spec/**`, and/or `reports/**` skips tests entirely (no test steps run); mixed with code paths, those paths are ignored and scoping follows the code paths as usual; mixed with a root-tooling path, the full suite still wins. So a PR's CI may show only a subset of conditional `Test (...)` steps under the single `checks` job — that's expected, not a skipped check. Branch protection keys off the stable `checks` job name, not the individual steps. Pushes to `main` always run the full suite.
- **CI ≠ `ready`.** PR CI does **not** run `lint:md`; `bun run ready` does. A green-CI markdown PR (plan/intent/seed/report/doc) can still carry lint-dirty generated markdown that, once merged, reddens **every** subsequent run's completion gate (`lint:md` globs `v1/spec/**`, `v1/docs/**`, `reports/**`, `README.md`, `AGENTS.md` — **not** `v2/docs/**`). `jarvis1 triage <spec-path> --merge` (or PR ref / worktree name) closes this gap: it runs `bun run ready` (including `lint:md`) before waiting for CI to be green, so both gates are enforced before merge. For direct hand-merge paths that bypass `--merge`, run `bun run lint:md` locally before admin-merging any PR that adds/edits markdown under those globs; green CI alone is not sufficient.
- **`Test (v2)` (agent mode) hangs are isolated per-file**, mirroring integration mode: a hung file's timeout message names the offending file and the run continues past it, instead of a bare global "test run timed out or was killed" with no file named.
- The intermittent `daemon-wait-run-completion.test.ts` staller (#1170, #1171) was root-caused to a leaked Linux inotify `FSWatcher` in `FsAppendWake` (`v2/src/persistence/log-stream.ts`) and **reduced** by `.unref()`-ing every watcher and abort-poll timer it creates (#1191), then **resolved**: `FsAppendWake` and the `fs.watch`-backed wake seam are deleted; `LogReader.follow` (`v2/src/persistence/log-stream.ts`) now blocks only on a fixed `FOLLOW_POLL_MS` poll between `tail()` rescans, so no watcher exists to leak. `follow()`'s wake mechanism moved from `fs.watch` to poll, and the daemon's shared wait-fanout was later replaced with a per-waiter `follow()` (#1232) — either way no watcher handle remains to outlive teardown.

## Session start

Every session starts the same way: feed incoming friction into the system **before** driving work, then turn the backlog into shippable work.

1. **Pull `main`** and check for surviving `.worktree/` state from a prior session (finalize or `jarvis1 cleanup`).
2. **Sweep open intake issues** and triage each into a seed (see [Triage](#triage-jarvis-on-jarvis-operator)):

   ```sh
   gh issue list --repo cbrenner04/jarvis --state open
   ```

   Match each issue against existing seeds/ready-intents first so you only seed what isn't captured. In-scope friction can be queued into this session (the issue stays open until its fix merges). Re-check at close-out for issues filed mid-session.
3. **Create ready-intents for all open seeds.** Run `jarvis1 intent <seed-file>` on every seed (seeds must be committed to `main` first), review + merge each draft PR. This drains the seed backlog.
4. **Complete the most important ready-intents — open-issue-backed first.** Open issues are the highest-signal backlog (someone hit real friction and filed it). Lead with issue-backed intents, ranked within that set by operator impact (recurring manual intervention > blockers > correctness/safety > polish); a self-surfaced gap competes on the same impact scale and may preempt only a clearly-lower-value issue. **Prioritize means implement, not triage** — a seeded issue is not a closed one; its fix-PR closes it via `Closes #N`, often in a later session, so the open-issue count is a backlog reading, not a per-session scoreboard. For each: `jarvis1 plan <ready-intent>` to draft the spec (merge it), then `jarvis1 run <spec>` to implement (review + admin-merge). **Complete 5 by default**; do fewer or more only when the owner says so.

Steps 1–2 first (not as an end-of-session afterthought) is what guarantees outside friction enters the backlog. Steps 3–4 are the recurring throughput; "seed everything, intent everything, complete 5" is the standing shape — the owner can dial the 5 up or down per session.

### Shared model pool contention warning

When you start a patch run with Claude selected as the primary agent, Jarvis probes for other running Jarvis-owned Claude sessions. If one is detected, you will see:

```
warning: selected patch primary shares Claude pool with a live Jarvis operator/orchestration session. Pause the competing session to avoid contention.
```

This is **informational and non-blocking**: the run proceeds normally. The warning tells you that:

- The selected patch primary is Claude (after tier and override resolution).
- Another Jarvis operator or orchestration session is actively running a Claude agent.
- Both will compete for the same Claude API quota/pool during their concurrent runs.

**Operator response:**

If you see this warning and **quota/contention is a concern** (e.g., you're testing quota behavior or running many concurrent agents), pause the competing session(s) before continuing. You can:

1. Check running Jarvis sessions: `ps aux | grep jarvis1`
2. Find its spec and working directory.
3. Send a signal to pause it (e.g., `Ctrl-C` or `kill -SIGINT <pid>`), or let it finish if it's near completion.
4. Resume your own run (it will continue from the same iteration).

If quota contention is **not a concern** (e.g., you have ample quota or the competing session is wrapping up), you can ignore the warning and let both runs proceed concurrently.

## End-of-session cleanup

1. **`jarvis1 cleanup`** — removes merged worktrees and archives each completed spec into the `completed/` directory of its home (`v1/spec`, `v2/spec`, configured `targetDir`, or the external `~/.jarvis/specs/<project-safe-id>/completed/` home for `commit:false`). Merged-but-dirty worktrees (uncommitted porcelain, unpushed commits, or stale plan-review edits after a merged PR) retire via default merged-mode cleanup — no manual stash or `git worktree remove --force` first. For `commit:false`, it also prunes the consumed external `ready-intents/<branch-slug>.md`. Archival waits until the resolved spec name is complete (finalize completion semantics shared with triage `--mark-ready`: every non-human-only acceptance criterion across all linked subspecs, or the sole spec file, is checked; index routing checkboxes do not gate completion; vacuous-complete counts as incomplete while an open implementation PR or other patch worktree still owns that name). Plan PRs may `--merge` with unchecked subspec AC; that does not satisfy archival completeness — a merged plan spec with unchecked AC stays unarchived until AC are checked (or the spec is otherwise complete). Archival also requires no open PR on that name and no other `.worktree/<spec-name>/` besides the one just removed; failed guards log a skip line and leave the spec in place (exit `0`), but the merged worktree is still removed — safe after a merged plan PR while implementation continues. Archival is not limited to specs whose worktree was just removed: every run (`commit:true` only) also scans `<targetDir>` root for other complete, PR-free, worktree-free spec dirs — e.g. one merged in a prior session — and archives them too, under the same completeness/PR/worktree guards. Scope it to one stranded spec with `jarvis1 cleanup <spec-name>` (no `--abandon`). `jarvis1 cleanup --abandon` retires unmerged abandoned runs: closes one matching draft PR best-effort, force-removes the worktree, deletes the local and remote branch, and leaves the spec in place for re-run (never archives). Both modes prompt `[y/N]`; use `--dry-run` to preview.
2. **Prune consumed seeds.** Delete `<targetDir>/seeds/*` whose work shipped this session, and any leftover `<targetDir>/ready-intents/*` from a plan that didn't consume them (currently `v1/spec/` — see [Where seeds and intents live](#where-seeds-and-intents-live)).

## Branch-before-edit discipline

Never edit specs or code on `main` directly. Active specs run through Jarvis on per-spec worktrees; new specs draft in plan mode → merge → then a separate run. Operator-side doc edits get their own worktree/branch too. `main` stays a stable merge target.
