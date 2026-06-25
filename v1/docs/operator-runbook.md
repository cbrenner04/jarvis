# Jarvis-on-Jarvis Observer Runbook

Reference for the **observer** dogfooding Jarvis on the Jarvis repo itself — driving Jarvis runs to improve the harness, reviewing PRs, admin-merging, and recovering when automated gates fail. "Observer" and "operator" are used interchangeably.

Scope: this is the **Jarvis-on-Jarvis** runbook. An observer driving Jarvis on some *other* target repo isn't this doc's audience — they just run the prescribed process to land that repo's work, and surface any harness gaps through the intake (see [Harness suggestions from other repos](#harness-suggestions-from-other-repos)), which the Jarvis-on-Jarvis observer triages.

## North star

The observer should be touching **only `jarvis` commands — and as few as possible.** Every hands-on step that isn't invoking a jarvis command (resolving a conflict, reconciling an index, restoring a dropped test, manually finalizing, re-running after a transient) is a **harness gap, not the job** — each is a wip-intent waiting to be written, whose definition of done is "a future observer doesn't do this by hand."

But **"fewer manual steps" is not "more commands."** The fix for a manual step is almost always to fold the behavior into an *existing* command's automatic flow (the harness just does it inside `run`/`plan`/the gate), **not** to add a new subcommand. New commands are a last resort, for a genuinely distinct operator intent that can't live inside an existing flow. Resist command proliferation.

The measure of progress is the **shrinking count of manual interventions per session**, not the number of commands. Some turns surface a gap; many won't — don't force a new intent every turn.

## Observer responsibilities (definition of done)

An observer session is not done when the PRs merge — it's done when the findings and tooling persist. Every session owes:

1. **Drive + review + merge.** Background-run each Jarvis invocation, poll for state, review each PR, and admin-merge **only** when the diff is correct, in-scope, and leaks nothing sensitive (see [Merging](#merging)). Keep stuck work moving (diagnose, finalize, or re-queue).
2. **Create seeds** in `v2/spec/seeds/` for *anything about Jarvis itself* that should change — a harness gap, friction, or improvement surfaced while observing. Seed it; don't just mention it in the report.
3. **Triage incoming harness suggestions** from other-repo observers (see below) into seeds. The issue stays **open** until the fix is implemented and merged — it is not closed at triage.
4. **Write a final report** committed under `reports/` with a precise UTC-timestamp filename (e.g. `reports/2026-06-23T00-52-38Z-overlord.md`) — date-only names collide when there are multiple sessions a day. Cover: what shipped/merged; **workflow + tooling + harness observations** (failure modes hit, what worked); and a **cost breakdown** — Jarvis run spend (from `~/.jarvis/runs.jsonl`) plus the observer's own session cost, in the [standard cost schema](#cost-reporting-standard).
5. **Maintain this runbook** directly (branch → PR → admin-merge — lighter than the full intent→plan→run pipeline). Keep it current; batch edits rather than one PR per thought.
6. **Run end-of-session cleanup** ([below](#end-of-session-cleanup)) — `jarvis1 cleanup` to retire merged worktrees and archive specs into their home directories.

## Cost reporting standard

Every session closes four cumulative CSVs. Keep spec rows separate from observer rows.

- **`reports/session-costs.csv`** — one row per Jarvis spec/intent (plan + run phases).
- **`reports/overlord-costs.csv`** — one row per observer/overlord session.
- **`reports/session-outcomes.csv`** — one row per session cost row after outcome reconciliation.
- **`reports/overlord-outcomes.csv`** — one row per overlord cost row after outcome reconciliation.

The per-report markdown section mirrors only the cost-sheet fields. Outcome sheets stay CSV-only.

**`session-costs.csv` columns:**

`report, name, plan_model, plan_cost, plan_time, plan_tokens_in, plan_tokens_out, run_model, run_cost, run_time, run_tokens_in, run_tokens_out, total_cost, notes`

**`overlord-costs.csv` columns:**

`report, session, session_count, model, total_cost, avg_cost_per_spec, api_time, tokens_in, tokens_out, cache_read, cache_write, notes`

**`session-outcomes.csv` columns:**

`report, session_id, report_date, completed_work_units, success_status, failure_reason, session_type, agent_count, duration_minutes, files_touched, notes`

**`overlord-outcomes.csv` columns:**

`report, session_id, report_date, specs_driven, overall_success, failure_reason, session_type, duration_minutes, files_touched, notes`

Cost-row identities:

- Session cost rows are identified by **`(report, name)`**. `name` is not globally unique.
- Overlord cost rows are identified by **`(report, session)`**. `session` is not globally unique.
- Session outcome rows join to session cost rows on **`(report, session_id) -> (report, name)`**.
- Overlord outcome rows join to overlord cost rows on **`(report, session_id) -> (report, session)`**.
- Before writing or amending an outcome row, confirm the matching cost-sheet composite identity is unique. Duplicate cost identities are blocking; do not pick one silently.
- JSONL-derived patch fields additionally require a durable binding from the session cost identity to one JSONL namespace, one run window, and one run base. Record that binding in the matching `session-costs.csv` `notes` and mirror it in the markdown report.
- Overlord derived fields additionally require a durable binding from the overlord cost identity to its exact member session-cost identities and shared session base. Record that binding in the matching `overlord-costs.csv` `notes` and mirror it in the markdown report.
- For the already-written historical header-only outcome sheets, follow the exact historical backfill procedure and evidence limits in [v2/docs/outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md) instead of inventing lookalike bindings after the fact.

Cost-sheet rules:

- **Spec rows:** plan + run phases on one row; `total_cost` = plan + run.
- **One overlord row per session.** `total_cost` = the observer's own `/cost` total. If a session spans a compaction boundary (multiple reports, same operator `/cost`), combine into a single row.
- **Dedupe repeated specs across combined reports.** Keep one completed row and note alternate accounting.
- **Blank where it doesn't apply.** Plan-only or blocked-run specs leave run columns empty; reports without a phase split fill only `total_cost`.
- **Token columns are raw integers.** Expand `k`/`M` shorthand. Costs are dollars; times are `HH:MM:SS`.
- Each session appends its cost rows to both cost CSVs and mirrors them in the markdown report.
- For a patch session row, `notes` must bind `(report, name)` to `namespace`, `run_start_ts`, `run_end_ts`, and `run_base`.
- For an overlord row, `notes` must bind `(report, session)` to the exact member `(report, name)` set and the shared `session_base`.

Outcome reconciliation:

- Run **outcome reconciliation after final cost-row reconciliation and before closing the session report**.
- Reconciliation writes or amends **exactly one** outcome row for each uniquely identified cost row.
- On rerun or correction, amend the matching outcome row after rechecking the cost identity; do not append another row for the same cost row.
- If matching outcome rows are already duplicated, reconcile them back to one row when attribution is certain. If attribution is not certain, leave the conflict unresolved and explain it in `notes`.

Shared outcome-field semantics:

- `report_date`, `session_type`, `failure_reason`, `duration_minutes`, `files_touched`, and `notes` mean the same thing on both sheets so rows can be unioned later.
- `duration_minutes` is total plan-plus-run execution time in decimal minutes rounded to two decimals. Do not substitute overlord `api_time`; it is a different measure.
- `files_touched` is a non-negative count of distinct changed paths. Overlord rows use the distinct-path union for the whole session, not per-spec duplicates.
- Overlord `session_type` is always `orchestration`.

Outcome status semantics:

- `success_status` and `overall_success` use the same observer-judged values: `completed`, `partial`, `blocked`, `canceled`, `failed`, or blank when unknown.
- `plan-only` is a session shape, not a status value. Record it through the cost-row shape, `session_type`, `completed_work_units`, and `notes`; do not invent a terminal success/failure just to label it.
- Exit-derived status or failure hints are inputs to judgment, not overrides. When judgment differs from the hint, record the basis in `notes`.
- `completed_work_units` counts delivered scoped units: completed rows count all delivered units; partial rows count only delivered units; blocked/canceled/failed rows still count units completed before the terminal state; plan-only rows count `1` only for a finalized plan/spec. If the count is unknown, leave it blank and explain in `notes`.
- Leave unrecoverable judgment or derived values blank with an explanatory note. Blank and failure are distinct.

Source-or-blank derivation policy:

- Use the primary source documented in [v2/docs/outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md) first.
- Use a fallback only when it is attributable to the exact composite identity being reconciled; otherwise leave the field blank and explain it in `notes`.
- Patch JSONL-derived fields (`report_date`, `session_type`, `agent_count`, exit-derived status hints, exit-derived failure hints): require the durable `(report, name) -> namespace + run window` binding first. Without that binding, leave them blank and explain it in `notes`.
- Patch `report_date`: matching JSONL run start. If that row is unavailable, leave blank with a note; do not infer a date from the cost CSV `report` label.
- Patch `duration_minutes`: matching cost row `plan_time + run_time`.
- Patch `session_type` and `agent_count`: identity-bound JSONL (`mode`, distinct real agents). If plan phases are involved, use a contemporaneous observer record or leave blank with a note.
- Patch `files_touched`: identity-bound run-base git diff. Use a weaker git fallback only when every included commit is uniquely attributable to the same cost identity.
- Overlord derived fields (`report_date`, `duration_minutes`, `files_touched`): require the durable `(report, session) -> member session identities + session base` binding first. `session_count` and a shared report label are not enough. Without that binding, leave the derived fields blank and explain it in `notes`.
- Overlord `report_date`: earliest matched session outcome date; blank with a note when none exists.
- Overlord `specs_driven`: matching overlord cost row `session_count`.
- Overlord `duration_minutes`: uniquely matched session-cost rows for that overlord session.
- Overlord `files_touched`: distinct-path union across the identity-bound session set.

## Experimentation — encouraged, but bounded

Improving the harness means experimenting: cheaper agents, model tiering, cost/speed optimization. It's encouraged, within limits:

- **Not at the cost of churn or toil.** Don't thrash — batch tiny PRs, avoid parallelism that creates merge-conflict/reconciliation work, avoid spinning re-runs. Optimization should yield *less* toil.
- **Don't destabilize the harness.** Other repos depend on this harness — keep `main` green and treat `config.json` (agent order, models) carefully, since it affects all runs.
- **Cost/speed optimization** is worth pursuing, but through sanctioned channels (the model-tiering / codex-cache / transient-backoff intents), not corner-cutting.
- **Never circumvent prescribed process.** No hand-implementing specs to save time; specs go through plan→run→gate. Hand work is limited to *sanctioned recovery* (below) and must always re-run the gate.

## Harness suggestions from other repos

**Dual audience:** submit path (other-repo observer) and triage path (Jarvis-on-Jarvis observer) below.

An observer on a non-Jarvis target repo can't create seeds (they're not in this repo). They submit harness suggestions through the GitHub intake channel; the Jarvis-on-Jarvis observer triages each into a seed.

### Submit (other-repo observer)

Hit friction or found a harness gap? Submit it via the intake channel — no Jarvis repo checkout required.

#### Option 1: CLI

```sh
gh issue create --repo cbrenner04/jarvis --template harness-suggestion.md
```

(The `harness-suggestion` label is created during setup and applied automatically at submit time.)

#### Option 2: Web

Visit <https://github.com/cbrenner04/jarvis/issues/new/choose> and select the "Harness suggestion" template. The issue auto-labels itself.

### Triage (Jarvis-on-Jarvis observer)

**One-time prerequisite:** Create the harness-suggestion label (once per Jarvis repo):

```sh
gh label create harness-suggestion --repo cbrenner04/jarvis
```

Then, list incoming suggestions:

```sh
gh issue list --repo cbrenner04/jarvis --label harness-suggestion --state open
```

If the label is absent or you're filtering without it, fall back to searching the open-issue list manually.

For each suggestion:

1. **Review** the issue and assess whether it's worth a seed.
2. **Create a seed** in `v2/spec/seeds/` capturing the suggestion. Use the issue content to seed the intent's problem statement and decisions.
3. **Leave the issue open** and add a comment referencing the seeded intent (e.g., "Seeded as `<seeds-dir>/<name>.md`"). The issue tracks real remaining work, so it stays open until the fix is **implemented and merged** — the implementation PR closes it via a `Closes #N` keyword in its body. Do **not** close a seeded issue at triage; a seed is capture, not completion.
4. **Close at triage only when not seeding** — if the suggestion isn't actionable or doesn't warrant a seed (duplicate, or out-of-scope for Jarvis's design), close it then with an explanation. A *seeded* issue is never closed at triage.
5. **Operator-error / project-setup, not a harness gap.** If the issue is really an operator mistake or a problem with the *target project's* setup (misconfiguration, missing dependency, environment) rather than something Jarvis itself should change, **respond on the issue** explaining the cause/fix but **do not seed or change the harness** — and **flag it to the operator** so they're aware it surfaced. Don't bake a workaround into Jarvis for what is really a setup fix on the operator's side.

## Background-run-and-poll pattern

Launch long-running Jarvis invocations detached so they outlive the current shell/turn, then poll for completion:

```sh
nohup jarvis1 run <spec> >run.log 2>&1 &      # human shell
screen -d -m jarvis1 run <spec>
tmux new-session -d -s jarvis "jarvis1 run <spec>"
```

Poll via `tail -f run.log`, `git log --oneline -n 10` on the worktree branch, the spec's `index.md` checkbox count, or `~/.jarvis/runs.jsonl` (terminal `exit_reason` rows per `namespace`).

Avoid bare shell `&` — the process dies when the shell exits, and runs untracked.

**If the observer is itself an agent** with a background-task runner (e.g. Claude Code's background Bash): launch the Jarvis command **as the background task directly** — do *not* nest `nohup … &` inside it. Nesting detaches the process and returns immediately, so the runner marks the task "complete" while the real run keeps executing untracked (no exit notification). The bare command-as-task gives a clean completion signal.

## Concurrency — avoid cross-run conflicts

- **Don't run two Jarvis commands that touch the same files concurrently.** Separate worktrees prevent lock contention, but overlapping edits produce merge conflicts later (and CPU contention raises flake rates). Sequence runs that share files; merge each as it lands so branches stay close to `main`.
- **Don't branch-switch the primary checkout while a `plan`/`intent` is starting** — it reads the seed from the primary checkout at startup; a switch mid-read is a race. Merges and `pull` on `main` (no branch switch) are safe.
- For observer-side edits (like this runbook) while runs are in flight, work in a **separate worktree** so the primary checkout stays on `main`.

## Integration-merge-then-retest pattern

When a PR branched before recent merges (`mergeStateStatus: BEHIND`/`DIRTY`), reconcile before merging:

1. **Trial-merge `main` into the branch's worktree** (`git merge --no-commit origin/main`) and inspect conflicts.
2. **Resolve to keep both works' value** — don't blindly take one side. When two runs independently solved the same problem differently, merge toward the higher-coverage / more-correct outcome; recover any needed code verbatim from git rather than retyping.
3. **Re-run `bun run test`** (sandbox-off — process-spawning tests run there) on the merged tree, and confirm coverage didn't regress (see below) before committing the merge.
4. Push, `gh pr ready`, admin-merge.

**Watch for silently-dropped tests in refactor PRs.** A "mechanical, no-behavior-change" refactor can quietly delete or fail to relocate tests. Before merging, diff `grep -c 'test('` across the full test tree (including relocated `*.sandbox-unrunnable.test.ts` files) at branch HEAD vs the merge-base; if the count dropped, `comm -23` the sorted test names to see exactly which, and confirm each drop was intentional. Restore unintended drops verbatim from git.

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

- **Complete-but-dirty run.** Spec checklists all ticked but the worktree has uncommitted work the agent didn't commit before exiting — commit it and finalize (never auto-tick criteria).
- **Stuck-red completion (exit 10).** The completion gate failed repeatedly (either identically or with changing failures), the fix-up commits have been discarded (reset to the first-red baseline and force-pushed with `--force-with-lease`), and the PR is left at the original completed work without the chase edits. Finalize by hand: fix the underlying issue (e.g., a linting rule, a missing import, a flaky test), then rerun `jarvis1 run <spec>` to retry the fix-up iteration. The discarded edits remain accessible via git reflog if needed for reference.
- **Transient-killed plan.** A plan that died on a transient agent-error leaves a dirty plan worktree. If the review actuator had already finished (verdict file written, subspec edits applied) and only the commit/index-reconcile was lost, **reconcile the `index.md` to match the subspecs the actuator created, then commit** — cheaper and more deterministic than re-running the review pass. If the edits look truncated, discard and re-resume instead.
- **Flaky parallel-load failure.** Tests that pass serially/in-isolation but fail under `--parallel` are load flakes — re-run the failing test(s) in isolation; if green, finalize.

Admin-merge skips approval and CI gating but **not** local verification — always run `bun run ready` before merging.

## No-commit re-run auto-reset

When a `git: false` (no-commit) run is interrupted, killed, or blocked before completion, any acceptance-criteria checkboxes ticked and blockers appended during that run persist in the source spec on re-run. **Jarvis now automatically reverts these stale mutations** before agent invocation:

- Acceptance criteria ticked in the prior incomplete run are un-ticked.
- Any `## Blocker` appended is stripped.

The **observer no longer needs to manually revert checkboxes or strip blockers** before retrying a no-commit run after an interruption. Simply re-run with the same spec path: `jarvis1 run <spec>`. Pre-attempt checkboxes (authored before any run) remain ticked, so operator work is preserved.

## Sandbox blindness and false-negatives

The sandbox (e.g. in Claude Code) can hide real state:

### `ps`/`pgrep` blindness and flag traps

- Background processes spawned outside the sandbox are invisible to in-sandbox `ps`/`pgrep`; process inspection **must run sandbox-off**.
- Match on stable command tokens, not generic words: `pgrep -f 'cli.ts run <spec>'`, not `pgrep -f run`.
- **BSD/macOS `pgrep` has no `-c` count flag** (that's Linux procps). `pgrep -fc …` errors → a `|| echo 0` fallback then makes every process look dead. Count with `pgrep -f '<token>' | wc -l` instead.
- Workaround for liveness without process queries: poll the log, `runs.jsonl`, or git history.

### Localhost/auth/TLS blindness

`gh`/`git` network calls, `localhost` requests, and auth/keychain reads may fail *inside* the sandbox with TLS-cert or permission errors that are **false negatives**. Re-run the same command sandbox-off before debugging — if it succeeds there, the sandbox was the cause.

## Merging

`main` enforces branch protection (approval + passing CI) with no self-approval, and the owner has authorized **admin-merge** for this dogfooding workflow:

1. Spec complete (all acceptance criteria ticked) → Jarvis flips the draft PR to `ready` (or the observer runs `gh pr ready`).
2. Run `bun run ready` locally to verify lint/type/test pass (admin-merge does **not** re-verify).
3. `gh pr merge --admin --squash` overrides the approval/up-to-date requirement and merges directly.

Merge **only** when the diff is correct, in-scope, and leaks nothing sensitive. A `mergeStateStatus` of `BLOCKED` typically means branch-protection only (admin overrides); `DIRTY` means a real conflict to resolve first; `BEHIND` is mergeable via admin.

## The gate

- **`bun run ready`** — the full completion gate (typecheck + lint + tests, with a serial retry on parallel-test failure). Jarvis runs this automatically on spec completion; the observer runs it before any hand/admin-merge.
- **`check:fix`** (safe Biome fixes) leaves residual `noExplicitAny`/unused-var/non-null issues; **`check:fix:unsafe`** applies the riskier fixes and runs in the full ready tier before the final `check` lint. `noNonNullAssertion` has `fix: "none"` in `biome.json` (level retained at `warn`) — it is not rewritten by `check:fix:unsafe` because its autofix rewrites `!` to `?.`, which is `T | undefined` under `noUncheckedIndexedAccess` and fails the subsequent `typecheck` step.
- **`bun run typecheck`** is a separate gate (TS compiler; `noImplicitAny` lives in `tsconfig.json`, not Biome).
- Tests that spawn real processes live in `*.sandbox-unrunnable.test.ts` files and only run **sandbox-off**.

## End-of-session cleanup

Run before wrapping a session:

1. **`jarvis1 cleanup`** — removes merged worktrees and archives each completed spec into the
   `completed/` directory of the spec's home (the `v1/spec`, `v2/spec`, or configured `targetDir`
   where the spec is located). It prompts `[y/N]`; pipe `echo y | jarvis1 cleanup` in a non-interactive
   shell. (`--dry-run` to preview.) Each v1-authored spec archives to `v1/spec/completed/` and each
   v2-authored spec archives to `v2/spec/completed/`.
2. **Prune consumed seeds.** Delete `v2/spec/seeds/*` whose work shipped this session, and any
   `v2/spec/ready-intents/*` left over from a plan that didn't consume them.

## Branch-before-edit discipline

Never edit specs or code on `main` directly. Active specs run through Jarvis on per-spec worktrees (UTC-timestamp names); new specs draft in plan mode (own worktree) → merge → then a separate run. Observer-side doc edits get their own worktree/branch too. `main` stays a stable merge target.
