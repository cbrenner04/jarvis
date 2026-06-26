# Jarvis-on-Jarvis Observer Runbook

Reference for the **observer** dogfooding Jarvis on the Jarvis repo itself — driving runs, reviewing PRs, admin-merging, and recovering when gates fail. "Observer" and "operator" are interchangeable.

Scope: **Jarvis-on-Jarvis only.** An observer driving Jarvis on some *other* repo just runs the prescribed process to land that repo's work and surfaces harness gaps through the [intake](#harness-suggestions-from-other-repos), which the Jarvis-on-Jarvis observer triages.

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

Touch **only `jarvis` commands — as few as possible.** Every hands-on step that isn't a jarvis command (resolving a conflict, reconciling an index, restoring a dropped test, manually finalizing, re-running a transient) is a **harness gap**, a seed waiting to be written whose done-state is "a future observer doesn't do this by hand."

But **"fewer manual steps" is not "more commands."** The fix is almost always to fold the behavior into an *existing* command's automatic flow, **not** add a subcommand. New commands are a last resort for a genuinely distinct operator intent. The measure of progress is the **shrinking count of manual interventions per session** — not every turn surfaces a gap, so don't force one.

## Operator feedback cadence

The orchestration loop (the observer's own model calls) dominates session cost — far above the jarvis runs. So narrate sparingly:

- **Status updates only when something lands** — a PR merges, a stage completes, a seed ships. Tersely.
- **Otherwise, radio silence.** After launching background work, stop; the completion notification re-wakes you. No "still running" turns.
- **Interrupt only for a decision** you genuinely can't resolve yourself.

## Observer responsibilities (definition of done)

A session is done when the findings and tooling persist, not when the PRs merge. Every session owes:

1. **Drive + review + merge.** Background-run each invocation, poll for state, review each PR, and admin-merge **only** when the diff is correct, in-scope, and leaks nothing sensitive (see [Merging](#merging)). Keep stuck work moving.
2. **Create seeds** in the configured seeds dir (currently `v1/spec/seeds/` — see [Where seeds and intents live](#where-seeds-and-intents-live)) for anything about Jarvis itself that should change — a gap, friction, or improvement surfaced while observing. Seed it; don't just mention it in the report.
3. **Triage incoming harness suggestions** into seeds — sweep open issues at [session start](#session-start) and again at close-out. The issue stays **open** until its fix merges.
4. **Write a final report** under `reports/` with a UTC-timestamp filename (e.g. `reports/2026-06-23T00-52-38Z-overlord.md`) — date-only names collide. Cover what shipped/merged, workflow/tooling/harness observations, and a cost breakdown (Jarvis spend from `~/.jarvis/runs.jsonl` plus the observer's own session cost) in the [cost schema](#cost-reporting-standard).
5. **Maintain this runbook** directly (branch → PR → admin-merge). Keep it current; batch edits.
6. **Run [end-of-session cleanup](#end-of-session-cleanup)** — `jarvis1 cleanup` to retire merged worktrees and archive specs.

## Cost reporting standard

Every session closes four cumulative CSVs (spec rows separate from observer rows). The per-report markdown mirrors only the cost-sheet fields; outcome sheets stay CSV-only.

- **`reports/session-costs.csv`** — one row per Jarvis spec/intent (plan + run phases).
- **`reports/overlord-costs.csv`** — one row per observer/overlord session.
- **`reports/session-outcomes.csv`** — one outcome row per session cost row.
- **`reports/overlord-outcomes.csv`** — one outcome row per overlord cost row.

**Columns:**

- `session-costs`: `report, name, plan_model, plan_cost, plan_time, plan_tokens_in, plan_tokens_out, run_model, run_cost, run_time, run_tokens_in, run_tokens_out, total_cost, notes`
- `overlord-costs`: `report, session, session_count, model, total_cost, avg_cost_per_spec, api_time, tokens_in, tokens_out, cache_read, cache_write, notes`
- `session-outcomes`: `report, session_id, report_date, completed_work_units, success_status, failure_reason, session_type, agent_count, duration_minutes, files_touched, notes`
- `overlord-outcomes`: `report, session_id, report_date, specs_driven, overall_success, failure_reason, session_type, duration_minutes, files_touched, notes`

**Identity & joins:**

- Session cost rows: `(report, name)`. Overlord cost rows: `(report, session)`. Neither `name` nor `session` is globally unique.
- Outcome rows join to cost rows on `(report, session_id)` → `(report, name)` / `(report, session)`.
- Before writing/amending any outcome row, confirm the matching cost identity is unique. Duplicate cost identities are blocking — don't pick one silently.

**Durable bindings** (record in the cost row's `notes`, mirror in the markdown report):

- Patch session row: bind `(report, name)` to one JSONL `namespace`, `run_start_ts`, `run_end_ts`, `run_base`.
- Overlord row: bind `(report, session)` to its exact member `(report, name)` set and shared `session_base`.
- JSONL/derived outcome fields require this binding to exist first; without it, leave the field blank with a note. For the historical header-only outcome sheets, follow [v2/docs/outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md) instead of inventing bindings after the fact.

**Cost-sheet rules:**

- Spec rows: plan + run on one row; `total_cost` = plan + run. Blank columns where a phase doesn't apply (plan-only, blocked-run).
- One overlord row per session; `total_cost` = the observer's `/cost` total. A session spanning a compaction boundary (multiple reports, same `/cost`) is one row.
- Dedupe repeated specs across combined reports — one completed row, note the alternate accounting.
- Token columns are raw integers (expand `k`/`M`); costs are dollars; times are `HH:MM:SS`.

**Outcome reconciliation** (run after final cost-row reconciliation, before closing the report):

- Write/amend exactly one outcome row per uniquely identified cost row; on rerun, amend — never append a second row. Reconcile pre-existing duplicates back to one row when attribution is certain; otherwise leave the conflict and explain in `notes`.
- Shared fields (`report_date`, `session_type`, `failure_reason`, `duration_minutes`, `files_touched`, `notes`) mean the same on both sheets so rows can union later.
- `duration_minutes`: plan + run execution time, decimal minutes, 2dp — not overlord `api_time`. `files_touched`: count of distinct changed paths (overlord = whole-session union). Overlord `session_type` is always `orchestration`.

**Status semantics:**

- `success_status` / `overall_success`: `completed`, `partial`, `blocked`, `canceled`, `failed`, or blank when unknown. `plan-only` is a shape, not a status — record it via cost-row shape, `session_type`, `completed_work_units`, `notes`.
- Exit-derived status/failure are inputs to judgment, not overrides; record the basis in `notes` when judgment differs.
- `completed_work_units` counts delivered scoped units (partial/blocked/canceled/failed still count units done before the terminal state; plan-only = `1` only for a finalized plan). Unknown → blank + note. Blank and failure are distinct.

**Derivation:** use the primary source in [outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md); use a fallback only when attributable to the exact identity being reconciled, else blank + note.

- Patch `report_date`: JSONL run start (never inferred from the cost CSV `report` label). `duration_minutes`: cost-row `plan_time + run_time`. `session_type`/`agent_count`: identity-bound JSONL (`mode`, distinct real agents). `files_touched`: identity-bound run-base git diff.
- Overlord `report_date`: earliest matched session outcome date. `specs_driven`: cost-row `session_count`. `duration_minutes`: uniquely matched session-cost rows. `files_touched`: distinct-path union across the bound session set.

## Experimentation — encouraged, but bounded

Improving the harness means experimenting (cheaper agents, model tiering, cost/speed). Within limits:

- **Not at the cost of churn or toil.** Batch tiny PRs; avoid parallelism that creates merge-conflict/reconciliation work; avoid spinning re-runs. Optimization should yield *less* toil.
- **Don't destabilize the harness.** Other repos depend on it — keep `main` green and treat `config.json` (agent order, models) carefully.
- **Pursue cost/speed through sanctioned channels** (model-tiering / codex-cache / transient-backoff intents), not corner-cutting.
- **Never circumvent prescribed process.** No hand-implementing specs; they go through plan→run→gate. Hand work is limited to *sanctioned recovery* (below) and must always re-run the gate.

## Harness suggestions from other repos

**Dual audience:** submit path (other-repo observer) and triage path (Jarvis-on-Jarvis observer).

### Submit (other-repo observer)

Hit friction or found a gap? Submit via the intake channel — no Jarvis checkout required.

```sh
gh issue create --repo cbrenner04/jarvis --template harness-suggestion.md   # CLI
```

Or visit <https://github.com/cbrenner04/jarvis/issues/new/choose> and pick "Harness suggestion" (auto-labels).

### Triage (Jarvis-on-Jarvis observer)

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

## Background-run-and-poll pattern

Launch long-running invocations detached so they outlive the shell/turn, then poll:

```sh
nohup jarvis1 run <spec> >run.log 2>&1 &      # human shell
screen -d -m jarvis1 run <spec>
tmux new-session -d -s jarvis "jarvis1 run <spec>"
```

Poll via `tail -f run.log`, `git log --oneline` on the branch, the `index.md` checkbox count, or `~/.jarvis/runs.jsonl` (terminal `exit_reason` rows per `namespace`). Avoid bare shell `&` — the process dies with the shell and runs untracked.

**If the observer is itself an agent** with a background-task runner (e.g. Claude Code's background Bash): launch the jarvis command **as the background task directly** — do *not* nest `nohup … &` inside it. Nesting detaches and returns immediately, so the runner marks the task "complete" while the real run executes untracked (no exit notification).

## Concurrency — avoid cross-run conflicts

- **Don't run two commands that touch the same files concurrently.** Separate worktrees prevent lock contention, but overlapping edits produce merge conflicts later. Sequence runs that share files; merge each as it lands.
- **Throttle `jarvis run` (impl) to ~1–2 concurrent; fan out `plan`/`intent` freely.** Each `run`'s gate executes the full test suite, so 3–4 concurrent runs starve each other's gates and tip timing-sensitive tests over their timeouts — faking `exit 8`/`exit 1` on correct code. (Observed 2026-06-25: 4 concurrent runs, three gate-failed on one flaky test; all recovered by re-running each gate in isolation.) `plan`/`intent` have short gates and isolated spec dirs, so ~3–5 concurrent is fine. When an impl run gate-fails under contention, finalize by re-running its gate in isolation (sandbox-off) on the merged branch — green means contention flake, not bad code.
- **Don't branch-switch the primary checkout while a `plan`/`intent` is starting** — it reads the seed from the primary checkout at startup. Merges and `pull` on `main` (no branch switch) are safe.
- For observer-side edits (like this runbook) while runs are in flight, work in a **separate worktree**.

## Integration-merge-then-retest pattern

When a PR branched before recent merges (`mergeStateStatus: BEHIND`/`DIRTY`):

1. **Trial-merge `main` into the branch's worktree** (`git merge --no-commit origin/main`) and inspect conflicts.
2. **Resolve to keep both works' value** — don't blindly take one side. When two runs solved the same problem differently, merge toward the higher-coverage / more-correct outcome; recover code verbatim from git rather than retyping.
3. **Re-run `bun run test`** (sandbox-off) on the merged tree, confirm coverage didn't regress (below), then commit the merge.
4. Push, `gh pr ready`, admin-merge.

**Watch for silently-dropped tests in refactor PRs.** A "no-behavior-change" refactor can quietly delete or fail to relocate tests. Before merging, diff `grep -c 'test('` across the full test tree (including relocated `*.sandbox-unrunnable.test.ts`) at branch HEAD vs the merge-base; if the count dropped, `comm -23` the sorted test names to see which, and confirm each drop was intentional. Restore unintended drops verbatim from git.

## Manual-finalize recovery (last-resort path)

When automated gates fail or are unsafe to re-run, finalize by hand **in the worktree** (the observer is finalizing, not an agent editing mid-run):

```sh
git status && git diff                 # inspect worktree state
# fix issues (lint, types, flakes), then run the gate explicitly:
bun run ready
git add -A                             # caution: absorbs manual commits; Jarvis owns commits here
git commit -m "<message>"
gh pr ready && gh pr merge --admin --squash   # ready first — admin refuses a draft
```

Common cases:

- **Complete-but-dirty run.** Checklists all ticked but the worktree has uncommitted work — commit it and finalize (never auto-tick criteria).
- **Stuck-red completion (exit 10).** The gate failed repeatedly, fix-up commits were discarded (reset to first-red baseline, force-pushed with `--force-with-lease`), PR left at the original completed work. Recovery: fix the underlying issue. If the gate should now pass, `jarvis1 triage <worktree-name> --mark-ready` re-runs the gate once and promotes on green; otherwise rerun `jarvis1 run <spec>` to retry the fix-up. Discarded edits remain in git reflog.
- **Transient-killed plan.** Died on a transient agent-error, leaving a dirty plan worktree. If the review actuator finished (verdict written, subspec edits applied) and only the commit/index-reconcile was lost, reconcile `index.md` to match the subspecs the actuator created, then commit — cheaper than re-running the review. If edits look truncated, discard and re-resume.
- **Flaky parallel-load failure.** Tests that pass serially but fail under `--parallel` are load flakes — re-run the failing test(s) in isolation; if green, finalize.

Admin-merge skips approval and CI but **not** local verification — always run `bun run ready` before merging.

## No-commit re-run auto-reset

When a `git: false` (no-commit) run is interrupted before completion, **Jarvis now automatically reverts stale mutations** before the next agent invocation: acceptance criteria ticked in the prior incomplete run are un-ticked, and any appended `## Blocker` is stripped. Pre-attempt checkboxes (authored before any run) stay ticked.

The observer **no longer reverts checkboxes or strips blockers by hand** — just re-run with the same spec path: `jarvis1 run <spec>`.

## Sandbox blindness and false-negatives

The sandbox (e.g. in Claude Code) can hide real state.

### `ps`/`pgrep` blindness and flag traps

- Processes spawned outside the sandbox are invisible to in-sandbox `ps`/`pgrep`; process inspection **must run sandbox-off**.
- Match on stable command tokens: `pgrep -f 'cli.ts run <spec>'`, not `pgrep -f run`.
- **BSD/macOS `pgrep` has no `-c` flag** (that's Linux). `pgrep -fc …` errors → a `|| echo 0` fallback makes every process look dead. Count with `pgrep -f '<token>' | wc -l`.
- For liveness without process queries, poll the log, `runs.jsonl`, or git history.

### Localhost/auth/TLS blindness

`gh`/`git` network calls, `localhost` requests, and auth/keychain reads may fail *inside* the sandbox with TLS-cert or permission errors that are **false negatives**. Re-run sandbox-off before debugging — if it succeeds there, the sandbox was the cause.

## Merging

`main` enforces branch protection (approval + passing CI, no self-approval); the owner has authorized **admin-merge** for this dogfooding workflow:

1. Spec complete (all criteria ticked) → Jarvis flips the PR to `ready` (or run `gh pr ready`).
2. Run `bun run ready` locally — admin-merge does **not** re-verify.
3. `gh pr merge --admin --squash` overrides the approval/up-to-date requirement.

Merge **only** when the diff is correct, in-scope, and leaks nothing sensitive. `mergeStateStatus` `BLOCKED` is usually branch-protection only (admin overrides); `DIRTY` is a real conflict to resolve first; `BEHIND` is admin-mergeable.

## The gate

- **`bun run ready`** — the full completion gate (typecheck + lint + tests, with a serial retry on parallel-test failure). Jarvis runs it on spec completion; the observer runs it before any hand/admin-merge.
- **`check:fix`** (safe Biome fixes) leaves residual `noExplicitAny`/unused-var/non-null issues; **`check:fix:unsafe`** applies riskier fixes and runs in the ready tier before the final `check` lint. `noNonNullAssertion` has `fix: "none"` in `biome.json` — its autofix rewrites `!` to `?.`, which is `T | undefined` under `noUncheckedIndexedAccess` and fails the subsequent typecheck.
- **`bun run typecheck`** is a separate gate (`noImplicitAny` lives in `tsconfig.json`, not Biome).
- Tests that spawn real processes live in `*.sandbox-unrunnable.test.ts` and only run **sandbox-off**.

## Session start

Every session starts the same way: feed incoming friction into the system **before** driving work, then turn the backlog into shippable work.

1. **Pull `main`** and check for surviving `.worktree/` state from a prior session (finalize or `jarvis1 cleanup`).
2. **Sweep open intake issues** and triage each into a seed (see [Triage](#triage-jarvis-on-jarvis-observer)):

   ```sh
   gh issue list --repo cbrenner04/jarvis --state open
   ```

   Match each issue against existing seeds/ready-intents first so you only seed what isn't captured. In-scope friction can be queued into this session (the issue stays open until its fix merges). Re-check at close-out for issues filed mid-session.
3. **Create ready-intents for all open seeds.** Run `jarvis1 intent <seed-file>` on every seed (seeds must be committed to `main` first), review + merge each draft PR. This drains the seed backlog.
4. **Complete the most important ready-intents — open-issue-backed first.** Open issues are the highest-signal backlog (someone hit real friction and filed it) and stay open until their fix *merges*, so the open-issue count is the session's scoreboard: **it should drop every session.** Lead with issue-backed intents, ranked within that set by operator impact (recurring manual intervention > blockers > correctness/safety > polish); a self-surfaced gap competes on the same impact scale and may preempt only a clearly-lower-value issue. **Prioritize means implement, not triage** — a seeded issue is not a closed one. For each: `jarvis1 plan <ready-intent>` to draft the spec (merge it), then `jarvis1 run <spec>` to implement (review + admin-merge). The count flexes; complete the top few.

Steps 1–2 first (not as an end-of-session afterthought) is what guarantees outside friction enters the backlog. Steps 3–4 are the recurring throughput; the count flexes, but "seed everything, intent everything, complete the top few" is the standing shape.

## End-of-session cleanup

1. **`jarvis1 cleanup`** — removes merged worktrees and archives each completed spec into the `completed/` directory of its home (`v1/spec`, `v2/spec`, or configured `targetDir`). For `commit: false` projects, specs are archived from the external home `~/.jarvis/specs/<project-safe-id>/` to that home's `completed/` subdirectory, with no manual `mv` or ready-intent pruning required. It prompts `[y/N]`; pipe `echo y | jarvis1 cleanup` non-interactively (`--dry-run` to preview).
2. **Prune consumed seeds.** Delete `<targetDir>/seeds/*` whose work shipped this session, and any leftover `<targetDir>/ready-intents/*` from a plan that didn't consume them (currently `v1/spec/` — see [Where seeds and intents live](#where-seeds-and-intents-live)).

## Branch-before-edit discipline

Never edit specs or code on `main` directly. Active specs run through Jarvis on per-spec worktrees; new specs draft in plan mode → merge → then a separate run. Observer-side doc edits get their own worktree/branch too. `main` stays a stable merge target.
