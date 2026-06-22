# Observer Runbook

Reference for an **observer** driving Jarvis runs on a target repo — launching runs, polling them, reviewing PRs, admin-merging, and recovering when automated gates fail. "Observer" and "operator" are used interchangeably.

This runbook is **target-agnostic**: Jarvis is the constant; the repo it's pointed at varies. Where a concrete command appears (e.g. `bun run ready`), it's an example from dogfooding Jarvis-on-Jarvis — substitute the target repo's equivalent gate (its test/lint/typecheck commands, found in the target's `CLAUDE.md`/`AGENTS.md` or package scripts).

## Observer responsibilities (definition of done)

An observer session is not done when the PRs merge — it's done when the findings and tooling persist. Every session owes:

1. **Drive + review + merge.** Background-run each Jarvis invocation, poll for state, review each PR, and merge **only** when the diff is correct, in-scope, and leaks nothing sensitive. **Merge by the method you're instructed to use for the session; if no instruction is given, follow the target repo's own merge rules** — don't assume you may admin-merge or self-approve (see [Merging](#merging)). Keep stuck work moving (diagnose, finalize, or re-queue).
2. **Create wip-intents** in `v2/spec/wip-intents/` for *anything about Jarvis itself* that should change — a harness gap, friction, or improvement surfaced while observing. Seed it; don't just mention it in the report.
3. **Write a final report** (gitignored local artifact, e.g. `overlord-session-report.md`) covering: what shipped/merged; **workflow + tooling + harness observations** (failure modes hit, what worked); and a **cost breakdown** — Jarvis run spend (from `~/.jarvis/runs.jsonl`) plus the observer's own session cost.
4. **Maintain this runbook** directly (branch → PR → merge per the session/target rules — lighter than the full intent→plan→run pipeline). The user sends this runbook to observers as their onboarding doc, so keep it current and target-agnostic.

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
3. **Re-run the target's full gate** (sandbox-off if it spawns processes) on the merged tree, and confirm coverage didn't regress (see below) before committing the merge.
4. Push, mark ready, admin-merge.

**Watch for silently-dropped tests in refactor PRs.** A "mechanical, no-behavior-change" refactor can quietly delete or fail to relocate tests. Before merging, diff `grep -c 'test('` across the full test tree (including relocated `*.sandbox-unrunnable.test.ts`-style files) at branch HEAD vs the merge-base; if the count dropped, `comm -23` the sorted test names to see exactly which, and confirm each drop was intentional. Restore unintended drops verbatim from git.

## Manual-finalize recovery (last-resort path)

When automated gates fail or are unsafe to re-run, finalize by hand **in the worktree** (the observer is finalizing, not an agent editing mid-run):

```sh
git status && git diff                 # inspect worktree state
# fix issues (lint, types, flakes), then run the target's gate explicitly:
bun run ready                          # ← substitute target repo's gate
git add -A                             # caution: absorbs manual commits; Jarvis owns commits here
git commit -m "<message>"
gh pr ready                            # un-draft, then merge per the session/target rules
# Jarvis-on-Jarvis example: gh pr merge --admin --squash  (ready first — admin refuses a draft)
```

Common cases:
- **Complete-but-dirty run.** Spec checklists all ticked but the worktree has uncommitted work the agent didn't commit before exiting — commit it and finalize (never auto-tick criteria).
- **Transient-killed plan.** A plan that died on a transient agent-error leaves a dirty plan worktree. If the review actuator had already finished (verdict file written, subspec edits applied) and only the commit/index-reconcile was lost, **reconcile the `index.md` to match the subspecs the actuator created, then commit** — cheaper and more deterministic than re-running the review pass. If the edits look truncated, discard and re-resume instead.
- **Flaky parallel-load failure.** Tests that pass serially/in-isolation but fail under `--parallel` are load flakes — re-run the failing test(s) in isolation; if green, finalize.

No merge method substitutes for local verification — always run the target's gate before merging (admin-merge in particular skips approval and CI gating).

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

**Default rule: merge the way you're told to for the session. Absent any instruction, follow the target repo's own merge rules** — its branch protection, required approvals/reviewers, and CI gates. Do **not** assume admin-merge or self-approval is available; on most repos it isn't, and an observer is not the owner. When the rules are unclear or block you, surface it rather than forcing a merge.

The admin-merge path below is the **Jarvis-on-Jarvis convention only**: a single owner-operator repo where the owner has explicitly authorized `--admin` to bypass the no-self-approval rule. It does not generalize.

### Admin-merge (Jarvis-on-Jarvis, owner-operated)

`main` enforces branch protection (approval + passing CI) with no self-approval, so the owner authorizes admin-merge:

1. Spec complete (all acceptance criteria ticked) → Jarvis flips the draft PR to `ready` (or the observer runs `gh pr ready`).
2. Run the gate locally to verify lint/type/test pass (admin-merge does **not** re-verify).
3. `gh pr merge --admin --squash` overrides the approval/up-to-date requirement and merges directly.

A `mergeStateStatus` of `BLOCKED` typically means branch-protection only (admin overrides); `DIRTY` means a real conflict to resolve first; `BEHIND` is mergeable via admin.

## Target-repo gate specifics (example: Jarvis-on-Jarvis)

Gate commands vary per target — read the target's package scripts / `CLAUDE.md`. For the Jarvis repo itself:

- **`bun run ready`** — the full completion gate (typecheck + lint + tests, with a serial retry on parallel-test failure). Jarvis runs this automatically on spec completion; the observer runs it before any hand/admin-merge.
- **`check:fix`** (safe Biome fixes) leaves residual `noExplicitAny`/unused-var/non-null issues; **`check:fix:unsafe`** applies the riskier fixes and runs in the full ready tier before the final `check` lint.
- **`bun run typecheck`** is a separate gate (TS compiler; `noImplicitAny` lives in `tsconfig.json`, not Biome).
- Tests that spawn real processes live in `*.sandbox-unrunnable.test.ts` files and only run **sandbox-off**.

## Branch-before-edit discipline

Never edit specs or code on `main` directly. Active specs run through Jarvis on per-spec worktrees (UTC-timestamp names); new specs draft in plan mode (own worktree) → merge → then a separate run. Observer-side doc edits get their own worktree/branch too. `main` stays a stable merge target.
