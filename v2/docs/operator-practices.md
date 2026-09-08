# Operator practices

Engine-neutral discipline for the **operator** driving Jarvis on the Jarvis repo: what a session owes, how to merge, how to account for cost, and the traps that recur. Command mechanics (daemon, presets, recovery, cleanup) live in [`operator-runbook.md`](./operator-runbook.md). **Operator** is the single name for this role; older reports say *overlord* or *orchestrator*.

Scope: **Jarvis-on-Jarvis only.** An operator driving Jarvis on another repo runs that repo's process and surfaces harness gaps through the [intake](#harness-suggestions-from-other-repos), which the Jarvis-on-Jarvis operator triages.

## North star

Touch **only `jarvis` commands — as few as possible.** Every hands-on step that is not a jarvis command (resolving a conflict, reconciling an index, restoring a dropped test, hand-finishing, re-running a transient) is a **harness gap**: a seed whose done-state is "a future operator doesn't do this by hand."

But **"fewer manual steps" is not "more commands."** Fold the behavior into an existing command's automatic flow; new subcommands are a last resort for a genuinely distinct operator intent. The aim is a shrinking count of manual interventions per session — a qualitative read, not a tracked field.

## Operator feedback cadence

The orchestration loop (the operator's own model calls) dominates session cost, far above the jarvis runs. Narrate sparingly:

- **Two update points only: when you run a jarvis command, and when it lands.** One line each. No "still running" turns, no stage-by-stage narration. After launching background work, stop; the completion notification re-wakes you.
- **After every landed intent (implemented and on `main`), one short session paragraph** — what shipped, what is in flight, what is blocked.
- **Interrupt only for a decision** you genuinely cannot resolve yourself.

## Definition of done (session)

A session is done when the findings and tooling persist, not when the PRs merge. Every session owes:

1. **Drive + review + merge.** Background-run each invocation, review each PR, and admin-merge **only** when the diff is correct, in-scope, and leaks nothing sensitive (see [Merging](#merging)). Keep stuck work moving.
2. **Create seeds** under `v2/spec/seeds/` for anything about Jarvis itself that should change. Seed it; don't just mention it in the report. If you also work around the gap (a runbook caveat, a memory), link both ways: the stopgap names the seed and its cleanup trigger, the seed's **Documentation updates** names the stopgap to remove. Operator knowledge lives in the runbook and this doc — a private memory is a personal layer, never the system of record.
3. **Triage incoming harness suggestions** into seeds — sweep open issues at session start and at close-out. The issue stays **open** until its fix merges.
4. **Write a final report** under `reports/` with a UTC-timestamp filename (`reports/2026-06-23T00-52-38Z-operator.md`; date-only names collide). Cover what shipped, harness observations, and a cost breakdown in the [cost schema](#cost-reporting-standard). **Every implementation PR gets a link** — number and URL; a spec name alone does not identify the change that landed.
5. **Maintain the runbook and this doc** directly (branch → PR → merge). Batch edits.
6. **Run [end-of-session cleanup](#end-of-session-cleanup).**

## Cost reporting standard

Every session closes four cumulative CSVs (spec rows separate from operator rows). The per-report markdown mirrors only the cost-sheet fields; outcome sheets stay CSV-only.

- **`reports/session-costs.csv`** — one row per Jarvis spec/intent (plan + run phases).
- **`reports/operator-costs.csv`** — one row per operator session.
- **`reports/session-outcomes.csv`** — one outcome row per session cost row.
- **`reports/operator-outcomes.csv`** — one outcome row per operator cost row.
- **`reports/efficiency.csv`** — derived per-report rollup, regenerated from the four source CSVs.

**Which file is authoritative.** Cost lives in `~/.jarvis/telemetry.jsonl`, on `record_kind: invocation_completed` rows (`cost_usd`, `cost_source`, `usage.*`). Sum a session's rows by `ts` window or by `branch`. `~/.jarvis/runs.jsonl` is the frozen v1 record and receives nothing new. Invocations recorded before #1509 are permanently `cost_usd: null`; leave such cells blank with a note.

**Codex `cost_usd: null` is NOT a hole — recover it (2026-07-16).** Codex invocations record `cost_usd: null` / `usage_source: "unavailable"` when the rollout correlation misses, but the data is exact and on disk:

1. Start time = `ts - duration_ms` from the `invocation_completed` row.
2. Convert to **local** time — that is the rollout filename: `~/.codex/sessions/YYYY/MM/DD/rollout-<local-start-time>-<uuid>.jsonl`.
3. `grep -o '"total_token_usage":{[^}]*}' <file> | tail -1` — cumulative for that invocation. `input_tokens` includes `cached_input_tokens`; uncached input = `input_tokens - cached_input_tokens`.
4. Price with the model's `data/prices.json` row: `uncached·input_per_mtok + cached·cache_read_per_mtok + output·output_per_mtok`, ÷ 1e6.

This sums a session file, which is 1:1 with an invocation only because jarvis spawns a fresh codex session per invocation. Cleanup: delete when `codex-usage-from-invocation-stream` ships (#1655 keeps this as a labelled fallback).

**Sources.** Operator figures come from the operator's own CLI: Claude Code `/cost` for a Claude operator; the opencode SQLite db (`~/.local/share/opencode/opencode.db`, `session` table — `cost`, `tokens_input`, `tokens_output`, `tokens_cache_read`, `tokens_cache_write`) for an opencode operator. `api_time` is blank for opencode. Harness-fact vs operator-annotation classification: [`telemetry-capture.md`](./telemetry-capture.md).

**Columns:**

- `session-costs`: `report, name, plan_model, plan_cost, plan_time, plan_tokens_in, plan_tokens_out, run_model, run_cost, run_time, run_tokens_in, run_tokens_out, total_cost, total_tokens, cost_per_1k_tokens, notes`
- `operator-costs`: `report, session, session_count, model, total_cost, cost_per_session, api_time, tokens_in, tokens_out, cache_read, cache_write, total_tokens, cost_per_1k_tokens, notes`
- `session-outcomes`: `report, session_id, report_date, cost, completed_work_units, success_status, failure_reason, session_type, agent_count, duration_minutes, cost_per_minute, files_touched, cost_per_file, notes`
- `operator-outcomes`: `report, session_id, report_date, specs_driven, cost, overall_success, failure_reason, session_type, duration_minutes, cost_per_minute, files_touched, cost_per_file, notes`
- `efficiency`: `report, specs_driven, completed_specs, partial_or_blocked, session_active_tokens, operator_active_tokens, cache_read, observed_cost, paid_cost_only, tokens_per_completed_spec, paid_cost_per_completed_spec`

**Identity & joins:**

- Session cost rows are keyed `(report, name)`; operator cost rows `(report, session)`. The key must be **unique within its `report`**; `name`/`session` alone repeat across reports.
- Outcome rows join to cost rows on `(report, session_id)` → `(report, name)` / `(report, session)`.
- Before writing an outcome row, confirm its key matches exactly one cost row. A duplicate key within a report is blocking.

**Durable bindings** (record in the cost row's `notes`, mirror in the report): bind each session row to its run ids / branch and time window; bind each operator row to its member session set. Derived outcome fields require the binding first; without it, leave the field blank with a note.

**Cost-sheet rules:**

- Spec rows: plan + run on one row; `total_cost` = plan + run; `total_tokens` = sum of the four token columns; `cost_per_1k_tokens` = `total_cost / total_tokens * 1000`. Blank columns where a phase doesn't apply.
- One operator cost row per session; `total_cost` = the operator's `/cost` total; `total_tokens` = `tokens_in + tokens_out` (cache columns tracked separately). A session spanning a compaction boundary is one row.
- Dedupe repeated specs across combined reports — one completed row, note the alternate accounting.
- Token columns are raw integers; costs are dollars; times are `HH:MM:SS`.
- `observed_cost` includes recorded session + operator costs. `paid_cost_only` excludes free-subscription rows; revise if billing changes.

**Outcome reconciliation** (after final cost-row reconciliation, before closing the report):

- Exactly one outcome row per cost row; on rerun, amend — never append a second row.
- Shared fields (`report_date`, `session_type`, `failure_reason`, `duration_minutes`, `files_touched`, `notes`) mean the same on both sheets.
- `cost`: matching cost-row total. `duration_minutes`: plan + run execution time, decimal minutes, 2dp — not operator `api_time`. `cost_per_minute` = `cost / duration_minutes`.
- `files_touched`: distinct changed paths (operator row = whole-session union). `cost_per_file` = `cost / files_touched`. The operator `session_type` is always `orchestration`.

**Status semantics:**

- `success_status` / `overall_success`: `completed`, `partial`, `blocked`, `canceled`, `failed`, or blank when unknown. `plan-only` is a shape, not a status.
- Exit-derived status is an input to judgment, not an override; record the basis in `notes` when judgment differs.
- `completed_work_units` counts delivered **subspecs**. Partial/blocked/canceled/failed still count subspecs done before the terminal state; plan-only = `1` only for a finalized plan. Unknown → blank + note.

## Experimentation — encouraged, but bounded

Improving the harness means experimenting (cheaper agents, model tiering, cost/speed). Within limits:

- **Not at the cost of churn or toil.** Batch tiny PRs; avoid parallelism that creates reconciliation work; avoid spinning re-runs.
- **Quota depletion by your own fan-out is acceptable when the work is useful.** Don't artificially reorder agents or cap concurrency just to preserve quota (owner guidance, 2026-06-26).
- **Don't destabilize the harness.** Other repos depend on it — keep `main` green and treat `~/.jarvis/config.json` and `config/machines/*.json` carefully.
- **Pursue cost/speed through sanctioned channels** (model tiering, caching, backoff intents), not corner-cutting.
- **Never circumvent prescribed process.** No hand-implementing specs; they go through intent → plan → implement → gate. Hand work is limited to sanctioned recovery ([Hand-finishing](#hand-finishing)) and must re-run the gate.

**Actuator observations.** cursor (Composer 2.5) is a solid primary but can stall or blow the iteration ceiling on a complex spec, and it is **not free** — a paid subscription whose cost is merely untracked (`cost_usd: null`). `opencode/deepseek-v4-flash-free` is not viable solo. `opencode/glm-5.2` is a capable paid escalation (~$2.50/run). Claude is a valid primary: the historical "claude stalls to zero output" diagnosis was a harness measurement gap (batch JSON output invisible to the watchdog), fixed by streaming. Current per-agent notes: [`operator-runbook.md` § Choosing an actuator](./operator-runbook.md#choosing-an-actuator).

**Fallback gotchas:** `model_config` is **terminal — no cascade**. An unauthenticated primary (`Authentication required`) and a `model at capacity` refusal both classify as `model_config`, so promoting such an agent to the head of the order hard-fails every run until it is fixed. Verify auth before leading with an agent; drop a capacity-refusing agent from the order until capacity returns.

## Harness suggestions from other repos

**Submit (other-repo operator):**

```sh
gh issue create --repo cbrenner04/jarvis --template harness-suggestion.md
```

Or <https://github.com/cbrenner04/jarvis/issues/new/choose> → "Harness suggestion".

**Triage (Jarvis-on-Jarvis operator):**

```sh
gh issue list --repo cbrenner04/jarvis --label harness-suggestion --state open --json number,title,comments \
  --jq '.[] | "#\(.number) \(.title) — comments: \(.comments|length)"'
gh issue view <n> --repo cbrenner04/jarvis --comments      # body + comments
```

**Always read the comments.** `gh issue list` returns titles only and `gh issue view` omits comments unless asked; the owner routinely adds decisive context as a comment after filing. Observed 2026-07-12 on #1453: the body proposed a whole sandbox-policy architecture; the owner's comment said to confirm assumptions first; three core assumptions then failed against the code, and the seed became a fraction of the ask.

For each suggestion:

1. **Review body and comments** and assess whether it's worth a seed.
2. **Verify claims against the code before seeding.** A report of friction is not a diagnosis; seed what verifies and say what didn't.
3. **Seed it** under `v2/spec/seeds/` using the issue content.
4. **Leave the issue open** and comment with the seed path. The implementation PR closes it via `Closes #N`. A seed is capture, not completion.
5. **Close at triage only when not seeding** (not actionable, duplicate, out-of-scope), with an explanation.
6. **Operator error / project setup is not a harness gap.** Respond on the issue with the fix, don't change the harness, flag it to the operator.

## Concurrency

- **Don't run two commands that touch the same files concurrently.** Sequence runs that share files; merge each as it lands.
- **Fan out `plan`/`intent` freely; implement fan-out is bounded by the gate, not the lane count** — current numbers and the `shared/**` exception are in [`operator-runbook.md` § Concurrency](./operator-runbook.md#concurrency). A gate failure under load is worth one isolated re-run before trusting it.
- **Don't branch-switch the primary checkout while a `plan`/`intent` is starting** — it reads its seed from the primary checkout at startup. Operator-side edits go in a separate worktree.
- **Merging to `main` during a long in-flight run can leave that run behind base.** Batch merges for when no lane is live, or expect [integration](#integration-merge-then-retest-pattern) on conflict.

## Integration-merge-then-retest pattern

When a PR branched before recent merges (`mergeStateStatus: BEHIND`/`DIRTY`) and auto-integration did not run or failed:

1. **Trial-merge `main` into the branch's worktree** (`git merge --no-commit origin/main`) and inspect conflicts.
2. **Resolve to keep both works' value** — when two runs solved the same problem differently, merge toward the more-correct outcome; recover code verbatim from git rather than retyping.
3. **Re-run the gate** (sandbox-off) on the merged tree, confirm test coverage didn't regress, then commit the merge.
4. Push, `gh pr ready`, admin-merge.

**Watch for silently-dropped tests in refactor PRs.** Diff `grep -c 'test('` across the test tree at branch HEAD vs merge-base; if the count dropped, `comm -23` the sorted names and confirm each drop was intentional.

**Two plans extending the same type union reliably conflict on merge**, not just touch nearby lines — a naive `--ours`/`--theirs` drops one side. Delegate the three-way reconciliation if you like, but re-verify yourself (typecheck, `bun run check`, tests) and budget for a follow-up lint round (observed 2026-07-05).

## Hand-finishing

Sanctioned recovery only, in the worktree, never in the primary checkout:

```sh
git status && git diff                 # inspect
# fix lint, types, flakes, then:
bun run ready                          # or: check + typecheck + scoped tests + lint:md
git add -A && git commit -m "<message>"
gh pr checks <n>                       # its own command; exits nonzero on failure
gh pr ready <n> && gh pr merge <n> --admin --squash
```

- **Green tests alone are not a gate — `bun test` does not typecheck.** Run `bun run check` (format, complexity, guard scripts) plus `bun run lint:md` when markdown changed; `bun run ready` covers all of it. Biome `noNonNullAssertion` findings are warnings, not the failing errors listed beside them.
- **`gh pr merge --admin` does not refuse a red PR.** Admin overrides approval *and* CI. Confirm `gh pr checks <n>` green before every admin-merge (observed 2026-07-14: #1513 merged red).
- **Never chain the check and the merge.** `gh pr checks <n> | head && gh pr merge …` merges on failure (the pipeline exit is `head`'s; `--watch` completes on failure too). Same trap piping lint through `tail`: verify by exit code.
- **Red tests on an agent's commit may be correctly red.** Trace the failure to the implementation before "fixing" a test to match observed behavior (2026-07-14: sixteen "stale" red tests were flagging a real transport bug).
- **Run stranded at `blocked` with unsatisfiable AC.** A criterion asserting CI status, PR body, or review state cannot be ticked from a worktree. Fix the spec on `main` — mark it `(Manual)` or rewrite it as a worktree-verifiable outcome — then re-run.
- **CI-only failure (passes locally).** Path/fs-sensitive bugs can pass under `$TMPDIR` and fail deterministically in CI's `/tmp`. After one or two unproductive rounds, abandon the worktree (`jarvis cleanup --abandon <name>`) and re-run fresh on a stronger agent. CI is the load-bearing gate for such code.
- **A gate flake under CPU contention may come from an orphaned process, not a co-running session.** Check `ps` for a high-CPU process whose parent is `1`/`launchd` before assuming concurrency; sweep leaked test fixtures at session start (see the runbook's Known gotchas).

## Merging

`main` enforces branch protection (approval + passing CI, no self-approval); the owner has authorized **admin-merge** for this dogfooding workflow. There is no jarvis merge command; the gated path is by hand:

1. Spec-backed implementation PRs must be complete. Plan, intent, seed, report, and docs PRs use the same path.
2. Local gate green (`bun run ready`, or `check` + `typecheck` + the scoped test scripts + `lint:md`).
3. `gh pr checks <n>` green, as its own command.
4. `gh pr ready <n> && gh pr merge <n> --admin --squash`.

Merge **only** when the diff is correct, in-scope, and leaks nothing sensitive. `mergeStateStatus` `BLOCKED` is usually branch protection (admin overrides); `DIRTY` is a real conflict to resolve first; `BEHIND` is admin-mergeable.

Agent operators: `gh pr merge --admin` to the default branch can be denied by the agent harness's own safety classifier even when `gh pr merge` is allow-listed (Claude Code auto-mode `autoMode.allow`). That is session-harness config the agent must not self-edit — the owner adds the entry or runs the merges via `!`; do not retry the denied merge verbatim.

## The gate: CI vs `ready`

- **`bun run ready`** is the completion gate: `check`, `typecheck`, the aggregate test suite (`scripts/run-tests.ts`), and `lint:md`. Autofix (`fixCommand`, default `bun run fix`) runs first and commits its output; verification runs strict against the committed tree. Red verification settles the run failed with no fix-up agent or PR promotion.
- **CI scopes tests by changed path** (`scripts/ci-test-scope.ts`): `v2/**` → `test:v2` + `test:integration:v2`; `shared/**` → those plus `test:shared` + `test:integration:shared`; root `test/**` → the shared pair; docs, specs, `ready-intents/`, `reports/`, and the frozen `v1/**` tree → no tests; root tooling or an unmatched path → the full aggregate. A PR's `checks` job shows only the matching conditional steps — expected, not a skipped check. Pushes to `main` run the full suite.
- **CI does not run `lint:md`; `ready` does.** A green-CI markdown PR can carry lint-dirty prose that reddens every subsequent run's gate once merged. Run `bun run lint:md` locally before admin-merging any PR that touches `v2/docs/**`, `v2/spec/**`, `reports/**`, `README.md`, or `AGENTS.md`; repair soft wraps with `bun run reflow:md`.
- **When a gate goes red on a diff that cannot explain it**, verify path classification, then suspect machine load or a leaked process before suspecting the code.

## Session start

Mechanics (daemon, config, readiness, orphan sweep) are the runbook's [Session start](./operator-runbook.md#session-start). The standing shape of a session:

1. **Pull `main`** and finalize or clean up surviving worktrees from a prior session.
2. **Sweep open intake issues** and triage each into a seed ([Triage](#harness-suggestions-from-other-repos)). Match against existing seeds/ready-intents first; re-check at close-out.
3. **Intent every open seed** (`jarvis run workflow intent --seed <file>`; seeds must be on `main` first), review + merge each draft PR.
4. **Complete the most important ready-intents — issue-backed first**, ranked by operator impact (recurring manual intervention > blockers > correctness/safety > polish). Plan (`jarvis run workflow plan --ready-intent <file>`, merge), then implement (`jarvis run workflow implement --spec <index.md>`, review + merge). **Complete 5 by default**; the owner dials it up or down.

Steps 1–2 first is what guarantees outside friction enters the backlog; 3–4 are the recurring throughput.

## End-of-session cleanup

1. **`jarvis cleanup <project> -y`** retires merged worktrees and archives completed specs (contract: [`operator-runbook.md` § Cleanup](./operator-runbook.md#cleanup-eligibility-gate)). `--abandon <name>` retires an unmerged wedged workspace. Piped confirmation cancels; use `-y`.
2. **Prune consumed seeds.** Delete `v2/spec/seeds/*` whose work shipped and leftover `v2/spec/ready-intents/*` no plan consumed. Do not prune on the strength of a same-named dir in `completed/` — archives can be premature. Verify the feature is on `main` and any claimed merge SHA is an ancestor (`git merge-base --is-ancestor <sha> main`).

## Branch-before-edit discipline

Never edit specs or code on `main` directly. Active specs run through Jarvis on per-spec worktrees; new specs draft through `plan` → merge → a separate implement run. Operator-side doc edits get their own worktree/branch. `main` stays a stable merge target.
