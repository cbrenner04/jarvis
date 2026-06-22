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
2. **Create wip-intents** in `v2/spec/wip-intents/` for *anything about Jarvis itself* that should change — a harness gap, friction, or improvement surfaced while observing. Seed it; don't just mention it in the report.
3. **Triage incoming harness suggestions** from other-repo observers (see below) into wip-intents.
4. **Write a final report** (gitignored local artifact, e.g. `overlord-session-report.md`) covering: what shipped/merged; **workflow + tooling + harness observations** (failure modes hit, what worked); and a **cost breakdown** — Jarvis run spend (from `~/.jarvis/runs.jsonl`) plus the observer's own session cost.
5. **Maintain this runbook** directly (branch → PR → admin-merge — lighter than the full intent→plan→run pipeline). Keep it current; batch edits rather than one PR per thought.
6. **Run end-of-session cleanup** ([below](#end-of-session-cleanup)) — `jarvis1 cleanup` to retire merged worktrees and archive specs, then relocate any v1-work specs it parked under `v2/spec/completed/` into `v1/spec/completed/`.

## Experimentation — encouraged, but bounded

Improving the harness means experimenting: cheaper agents, model tiering, cost/speed optimization. It's encouraged, within limits:

- **Not at the cost of churn or toil.** Don't thrash — batch tiny PRs, avoid parallelism that creates merge-conflict/reconciliation work, avoid spinning re-runs. Optimization should yield *less* toil.
- **Don't destabilize the harness.** Other repos depend on this harness — keep `main` green and treat `config.json` (agent order, models) carefully, since it affects all runs.
- **Cost/speed optimization** is worth pursuing, but through sanctioned channels (the model-tiering / codex-cache / transient-backoff intents), not corner-cutting.
- **Never circumvent prescribed process.** No hand-implementing specs to save time; specs go through plan→run→gate. Hand work is limited to *sanctioned recovery* (below) and must always re-run the gate.

## Harness suggestions from other repos

**Dual audience:** submit path (other-repo observer) and triage path (Jarvis-on-Jarvis observer) below.

An observer on a non-Jarvis target repo can't create wip-intents (they're not in this repo). They submit harness suggestions through the GitHub intake channel; the Jarvis-on-Jarvis observer triages each into a wip-intent.

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

1. **Review** the issue and assess whether it's worth a wip-intent.
2. **Create a wip-intent** in `v2/spec/wip-intents/` capturing the suggestion. Use the issue content to seed the intent's problem statement and decisions.
3. **Close the issue** with a comment referencing the seeded intent (e.g., "Seeded as v2/spec/wip-intents/2026-06-22-example-intent.md").
4. **Allow closing without a seed** if the suggestion isn't actionable or doesn't warrant an intent — rare, but OK (e.g., duplicate of an existing issue, or out-of-scope for Jarvis's design).

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
- **Transient-killed plan.** A plan that died on a transient agent-error leaves a dirty plan worktree. If the review actuator had already finished (verdict file written, subspec edits applied) and only the commit/index-reconcile was lost, **reconcile the `index.md` to match the subspecs the actuator created, then commit** — cheaper and more deterministic than re-running the review pass. If the edits look truncated, discard and re-resume instead.
- **Flaky parallel-load failure.** Tests that pass serially/in-isolation but fail under `--parallel` are load flakes — re-run the failing test(s) in isolation; if green, finalize.

Admin-merge skips approval and CI gating but **not** local verification — always run `bun run ready` before merging.

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

1. **`jarvis1 cleanup`** — removes merged worktrees and archives each completed spec into
   `v2/spec/completed/`. It prompts `[y/N]`; pipe `echo y | jarvis1 cleanup` in a non-interactive
   shell. (`--dry-run` to preview.)
2. **Relocate v1-work specs.** `cleanup` archives every spec under `v2/spec/completed/` regardless of
   what it touched. Specs that actually implemented v1 changes (anything under `v1/`, `shared/`, or
   root config like `biome.json`) belong in **`v1/spec/completed/`** — move them there
   (`git mv v2/spec/completed/<spec> v1/spec/completed/`) so `v2/spec/completed/` holds only genuine
   v2 planning work. Pure-v2 specs stay put. Commit the move (branch → PR → admin-merge).
3. **Prune consumed seeds.** Delete `v2/spec/wip-intents/*` whose work shipped this session, and any
   `v2/spec/ready-intents/*` left over from a plan that didn't consume them. Batch with the move.

> This hand-relocation is a known harness gap (`cleanup` should route a spec to the right
> `vN/spec/completed/` by what it changed); seeded as a wip-intent, not yet automated. Until then, do
> it by hand here.

## Branch-before-edit discipline

Never edit specs or code on `main` directly. Active specs run through Jarvis on per-spec worktrees (UTC-timestamp names); new specs draft in plan mode (own worktree) → merge → then a separate run. Observer-side doc edits get their own worktree/branch too. `main` stays a stable merge target.
