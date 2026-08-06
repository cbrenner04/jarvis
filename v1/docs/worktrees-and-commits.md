# Worktrees, commits, and pull requests

How `jarvis run` manages git state: worktree layout, resume guarantees, commit shape, push cadence, and draft PR lifecycle.

> **Scope**: this document applies only when effective `git` is `true` (the > default). When `git` is `false`, jarvis runs in > [loop-only mode](./run-loop.md#loop-only-mode-git-false): no worktree is > created, no commits or pushes happen, and no PR is opened or transitioned.

## Worktree layout

Spec runs create dedicated git worktrees under `.worktree/<spec-name>/`. The `.worktree/` directory is tracked (via `.worktree/.keep`) so clones receive it, but its contents are ignored in git — only `.keep` is committed.

The agent runs in the worktree, not the main checkout, so concurrent spec runs (with different specs) do not interfere with each other.

After the worktree is ready, the worktree is the run source of truth. Jarvis maps the requested spec path into that worktree and uses the worktree-local spec for prompts, task banners, completion checks, and no-progress checks. If the spec directory exists only in the main checkout, Jarvis seeds missing spec files into the worktree without overwriting files already present there. Those seeded copies are normal files in the worktree working tree: if they are not yet on the feature branch, they start out **untracked** until you `git add` and commit them.

Agents must leave the worktree **clean** (no uncommitted or untracked changes) once every checkbox is checked, or `jarvis run` exits `6` instead of treating the spec as complete — otherwise the harness can report "done" while the draft PR never receives the work.

## Resume guarantees

When re-running a spec:

- **Worktree and branch both exist**:
  - If the branch is an orphan (zero commits ahead of base): retire both
    (`git worktree remove --force` + `git branch -D`) and create fresh.
  - If the branch has commits (WIP from a prior incomplete run): reuse both,
    clear litter (`git clean -fdx`), and resume from the WIP commit.
- **Worktree missing, branch exists locally or remotely**: recreate worktree
  on the existing branch, clear litter.
- **Neither exist**: create new branch and worktree, cutting the branch from
  `origin/<base>` when that remote-tracking ref resolves locally and falling
  back to the local base branch name when it does not.

Exception: for an external Jarvis-owned spec authored by `plan.commit:false`, re-run with effective `git:true`, and still incomplete with unchecked non-human-only acceptance criteria, Jarvis does **not** reuse stale patch git state. If `.worktree/<spec-name>/.jarvis.lock` is not live, it first closes the single matching open draft PR (if any), deletes the stale patch worktree, local branch, and remote branch, then recreates a fresh branch/worktree from the current base branch. If the worktree lock is live, the matching open PR is non-draft, multiple open PRs match, or any cleanup step fails, the run aborts before agent invocation.

Orphan-retirement failures (e.g., branch checked out in another worktree, filesystem permissions) abort with a named error. This self-service recovery avoids requiring manual git commands before re-run.

## Review-feedback worktrees

`jarvis1 review-feedback <worktree-name>` auto-materializes the patch worktree at `.worktree/<worktree-name>/` from `origin/<worktree-name>` (or a local branch if no remote exists) when missing and `git: true` in config. In v1 it does not infer the target worktree from the current working directory and does not support plan worktrees (`plan-*` / `plan/<name>`). The target worktree must start clean (empty `git status --porcelain`) before the review-feedback command proceeds.

## Commit shape

Each completed subspec produces exactly one commit. Jarvis creates the commit itself (the agent should not run `git commit` during a subspec). The commit subject is the subspec's H1 heading (the first `#` line), verbatim. The commit body includes:

1. First line: `Spec: <relative path to subspec from repo root>`
2. A blank line
3. The verbatim `## Acceptance criteria` section from the subspec

The same commit also flips the index.md checkbox for the subspec from `[ ]` to `[x]`, staging both the work and the index update together.

If `git add -A` stages nothing, jarvis skips the per-subspec commit instead of aborting the run. This clean-tree no-op is tolerated on all three per-subspec commit paths: completion, `WIP:` progress, and `WIP:` blocker.

An `agent-error` exit can also take the `WIP:` progress path: when the failed iteration left tracked edits or newly checked acceptance criteria, jarvis commits that partial state as `WIP:` before exiting `3`, leaving the worktree clean. Untracked-only litter does not count as progress and produces no commit.

### Jarvis-Agent trailer

Every commit jarvis creates carries a `Jarvis-Agent: <label>` git trailer at the end of the commit message. This applies to all three commit shapes jarvis produces: subspec commits, `WIP:` progress commits, and `WIP:` blocker commits.

- **Name**: exactly `Jarvis-Agent`. No alternative spellings.
- **Value**: `agent.attributionLabel()` for the agent that produced the
  iteration — the same human-readable identifier used in the PR body
  attribution footer.
- **Placement**: at the end of the message, separated from the preceding
  body by exactly one blank line, in the standard git-trailer position so
  `git log --format='%(trailers)'` and `git interpret-trailers` both see
  it.
- **Empty label**: when the agent has no attribution label, the
  `Jarvis-Agent` line is omitted entirely.

Stamping `WIP:` commits as well as subspec commits keeps the data shape uniform across every commit jarvis writes, even though the PR body attribution footer only renders subspec commits.

When a clean-tree no-op skips the commit entirely, there is no jarvis-authored commit and therefore no `Jarvis-Agent` trailer for that subspec. In that case the work remains only in the agent's own commit and drops out of the rendered PR attribution footer.

## Push cadence

Each subspec commit is pushed immediately:

- **First commit**: `git push -u origin <branch>` (sets up tracking).
- **Subsequent commits**: `git push` (uses tracking from first push).

Push failures are errors that halt work; there is no automatic retry. This keeps the draft PR synchronized with the latest commit, allowing reviewers and CI to see incremental progress.

## Dependency installation on change

When a commit touches `package.json` or `bun.lock`, the harness detects the change and installs dependencies outside the agent sandbox (with network access). This resolves the constraint that neither agent can install when `node_modules` is a symlink to the primary checkout.

**Symlink promotion**: if the worktree's `node_modules` is a symlink, the install replaces it with a real directory. If it is already real, the install leaves it intact. On resume, the worktree-creation logic skips recreating the `node_modules` symlink if a real directory already exists at that path.

**Lockfile commit**: if the install regenerates `package.json` or `bun.lock`, the harness commits those changes as a dedicated Jarvis-owned commit with `Jarvis-Agent: harness` trailer. This commit is created before the ready gate runs, so the PR never ships with uncommitted lockfile changes.

**Install failure**: install failures are logged loudly but do not halt the run. The next iteration's typecheck and ready gate may fail if the dependency is not actually installed. This is a non-self-healing path — the operator must resolve the install manually by running the install command in the worktree.

## Draft PR lifecycle

After the first successful subspec commit lands, `jarvis run` opens a draft PR:

- **Title**: the H1 from the spec's `index.md` (e.g., "Git Workflow").
- **Body**: see [PR body](#pr-body) below.
- **Base branch**: the branch detected by the first subspec.

The PR remains in draft until the spec is complete. If a PR already exists (on resume), it is reused without modification to the body.

When the final subspec is completed and pushed, the draft PR automatically transitions to ready for review. On a `full`-tier gate the transition begins with built-in `bun run fix`; if that leaves the tree dirty the harness commits it (message `chore: apply pre-ready check:fix`, preserving the per-call-site `Jarvis-Agent` trailer) and pushes **before** verification. It then runs strict verification — built-in `bun run ready`, or the project's `readyCommand` if set — against the committed tree. When verification is green and porcelain is non-empty, the harness commits that output (message `chore: apply post-ready verification output`, preserving the per-call-site `Jarvis-Agent` trailer) and pushes before `gh pr ready`. Residual still-dirty porcelain after the post-verification commit aborts (exit 6) and leaves the PR draft. Built-in `ready` is strict verification-only and built-in autofix lives in `bun run fix`; the authoritative built-in ready/fix split, gate ordering, and step order live in [`v2/docs/v1-behaviors.md`](../../v2/docs/v1-behaviors.md). The test phase still runs `bun run test` (the aggregate test command that covers all slices); see [v2/docs/v1-behaviors.md#test-execution-and-development-workflows](../../v2/docs/v1-behaviors.md#test-execution-and-development-workflows) for the test-command contract. Autofix and verification subprocesses are each bounded by `iterationTimeoutMs` (10 min default); timeout failures name the command and gate label. If the ready gate fails, the PR remains in draft for manual correction. `fast`-tier gates are unchanged: they do not run `bun run fix`, commit fix output, post-verification commit, or post-verification porcelain enforcement.

After all readiness steps succeed, the harness calls `gh pr ready`. Jarvis never merges; human reviewers are responsible for approval and merge decisions.

### PR body

The PR body has three sections, in order:

1. **Deterministic header** generated by jarvis from `index.md`: the H1 only.
2. **Narrative section** bracketed by stable HTML-comment markers:

   ```
   <!-- jarvis:narrative:start -->
   <narrative content>
   <!-- jarvis:narrative:end -->
   ```

     The narrative is generated either **model-authored** (agent mode, default) or **deterministically** (template mode), controlled by the per-mode `prNarrative` config key (`modes.patch.prNarrative` or `modes.plan.prNarrative`):

     - **Agent mode** (default): the model wraps the Description + `Decisions:` block in literal `<<<PR_DESCRIPTION_BEGIN>>>` and `<<<PR_DESCRIPTION_END>>>` sentinels; the harness extracts only the content between them. Absent or malformed sentinels (opening or closing missing, or closing before opening), extracted content lacking `Decisions:`, or an injected sentinel in the spec context yield no narrative on first generation. When properly delimited and containing `Decisions:`, the narrative contains a short description followed by the `Decisions:` section with an unordered list of notable decisions. Agent mode produces contextual, reviewer-focused narrative but consumes more tokens.
     - **Template mode**: the narrative is built deterministically from the spec index subspec titles, branch commit subjects (`base..HEAD`), and branch diff stats (`base...HEAD`), rendered in order. Includes `## Subspecs` (with per-subspec why lines from the first prose line of each subspec body), `## Commits`, and `## Risk cues` (categorical flags like "no test changes" when source files change but test files don't) and `## Change summary` with per-area file and line counts. The narrative is marked with a generated-hash marker and is regenerated on every rewrite to reflect new commits and diffs. Template mode is deterministic and cheaper but produces lower-value narrative. Override to `template` by setting `modes.patch.prNarrative: "template"` or `modes.plan.prNarrative: "template"` in your config for cheap/deterministic runs.

     In both modes, reviewers may edit text *inside* the markers; jarvis preserves human edits verbatim on subsequent rewrites. Template mode regenerates the narrative on every rewrite to reflect new commits. Agent mode regenerates the narrative only when it is empty or still machine-owned. On rewrite in agent mode, when regeneration returns null, the prior machine-owned narrative is preserved as-is rather than being cleared.
3. **Attribution footer** rendered from the `Jarvis-Agent` git trailers on
   the PR-branch subspec commits, separated from the body by a `---` rule.
   The footer is one compact deduped summary line:
   `Written by <Label A>, <Label B>, <Label C> through Jarvis.`
   preserving first-appearance order. When only one unique label is present
   the line collapses to `Written by <Label> through Jarvis.`. When no
   labelled subspec commits exist, the footer (and `---` separator) is
   omitted.

Reviewers may **not** expect edits to the deterministic header or footer to survive a rewrite — those sections are regenerated from scratch.

#### Update cadence

The draft PR is created on the first successful subspec commit. The PR body is rewritten once at the completion transition (after the green ready gate, before shrink/review run), not after each intermediate subspec commit. WIP commits do **not** trigger an update.

The completion-time rewrite fetches the current PR body, extracts the narrative section between the markers (so reviewer edits inside the markers survive unchanged), rebuilds the deterministic header from `index.md`, renders the attribution footer from git trailers, and reassembles the body. Narrative regeneration depends on `prNarrative`:

- **Agent mode** (default): the narrative is regenerated only when it is empty or marked as machine-owned. When the narrative is empty and an agent is available, jarvis regenerates it by calling the model with the current spec and re-wraps it in fresh markers. With no agent available, an empty/missing narrative is simply omitted on that update.
- **Template mode**: the narrative is regenerated from the spec index, commits, and branch diff stats.

If `gh pr edit` fails (network, rate-limit, permissions) at completion time, jarvis emits a `harness` warning to stderr and continues the run. The PR remains at the draft-creation body content.

#### Existing config migration

Agent mode is the default for both patch and plan modes. If your existing `~/.jarvis/config.json` contains `prNarrative: "template"` (written from prior bootstrap), your config will continue to use template narrative unchanged — the harness validates stored keys and never consults new defaults. To adopt agent narrative on your existing PRs, hand-edit `~/.jarvis/config.json` to change those keys to `agent` or delete them to inherit the new defaults.

## Blocker handling

When a subspec cannot be completed (due to hook failure, ambiguity, or other issues), the active agent appends a `## Blocker` section to the subspec describing the problem, then commits and pushes as WIP. See [../AGENTS.md](../AGENTS.md#working-rules-for-agents-in-this-repo) for the blocker convention and resolution process.

## Plan-mode worktrees

Plan mode creates dedicated worktrees under `.worktree/plan-<plan-name>/` on a `plan/<plan-name>` branch. The `plan-` prefix distinguishes plan-mode worktrees from patch-mode worktrees (`.worktree/<name>/`) to prevent collision when both modes target the same spec name.

The plan name is determined up front from the ready-intent's frontmatter `name:` field. Jarvis verifies the name for collision with existing worktrees, branches, and specs, applying collision suffixing if needed. 

**Self-heal on re-run:** When a fresh `commit: true` run discovers a surviving `plan/<plan-name>` branch and worktree that are disposable (local-only scratch with no commits beyond the merge-base, no remote tracking ref, and no committed `<targetDir>/<timestamp>-<plan-name>` spec dir), the run tears down the stale worktree/branch and recreates fresh under the same `<plan-name>`. A dirty or uncommitted worktree is treated as disposable scratch. Non-disposable state (a committed spec dir, remote branch, or branch with plan commits beyond base) triggers normal collision suffixing (`-2`, `-3`, …) and the surviving state is preserved.

The worktree is created directly at `.worktree/plan-<plan-name>/` on `plan/<plan-name>`, and the `intent.md` is seeded as a byte-for-byte copy of the ready-intent.

**Phase commits** in plan mode have special subjects:

- `plan: draft` — commits the initial agent-drafted spec tree.
- `plan: review N` — commits review-pass refinements to the same spec tree.
- `plan: blocker` — records a blocker raised during draft/review.
- `plan: review N r<n>` — records resume review pass `N` for resume run `n`.
- `plan: blocker r<n>` — records a blocker raised during resume run `n`.

The `RESUME_SUBJECT_RE` regex retains the `refine` token for parsing legacy commits when computing resume counters, but `plan: refine` commits are never emitted by current code paths.

Push cadence follows the same pattern as patch mode: push after each commit. The first push uses `git push -u origin plan/<plan-name>` to set up tracking;

later pushes use plain `git push`.

When every scripted phase succeeds, plan mode attempts a readiness transition (mirroring **`jarvis run`** readiness semantics):
- If the branch's open PR is **draft**, the ready gate runs built-in `bun run fix` (committing any dirty output first), then built-in `bun run ready`, then post-verification commit-if-dirty when applicable (plan is not wired to `readyCommand`). Both subprocesses are bounded by `iterationTimeoutMs` (10 min default). On success, `gh pr ready` flips it to ready. On gate failure, the PR remains draft.
- If the branch's open PR is **already ready**, it remains untouched (idempotent).
- A later successful `jarvis plan --resume …` invocation retries the transition for still-draft PRs.

Encountering **`plan: blocker`** commits (or lingering blockers) stops before readiness—the PR stays draft until the blocker is cleared and **`jarvis plan --resume …`** succeeds.

## Cleanup

`jarvis1 cleanup [--abandon] [--dry-run]` removes merged worktrees and branches from the local repo. Useful after PRs have been merged on GitHub to keep `.worktree/` tidy. Patch-mode repos use **`.worktree/<spec-dir>/`**; plan branches use **`.worktree/plan-<plan-name>/`** (sans UTC prefix despite timestamped spec paths). Both modes are handled on the same conditions.

Default behavior:

- Enqueues worktrees whose branch PR is merged (`isMergedPr` inspection).
- Merged PR worktrees are force-removed regardless of porcelain or unpushed
  commits (`git worktree remove --force`); there is no dirty or unpushed skip.
- Not-merged worktrees silently skip at the merge gate (absent from preview, not
  removed). `isMergedPr` inspection failure keeps the same silent skip.
- Prompts for confirmation before removal (use `--dry-run` to preview with
  `(patch)` or `(plan)` tags).
- Removes the git worktrees and deletes the matching local branches. Branch
  deletion tries Git's safe `-d` path first, then force-deletes the local branch
  if Git rejects it as not fully merged. This handles squash-merged and
  rebase-merged PRs after the merge gate and confirmation have passed.

- Afterwards tries **`<targetDir>/<archive>/ → <targetDir>/completed/<archive>/`** using a filesystem `rename()` when **`<targetDir>/<archive>/`** exists. For patch layouts, **`<archive>`** is the branch/worktree name. For plan layouts, cleanup strips the **`plan/`** branch prefix (**`<archive> = plan-name`**) and uses the project's configured plan `targetDir` (default: `spec`).

- If the exact plan archive path is missing, cleanup also recognizes timestamped plan directories matching **`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/`** and moves the matched timestamped directory to **`<targetDir>/completed/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/`**.

- When that rename succeeds, cleanup creates and pushes a commit in the project root that stages only the moved spec paths.

- If **`<targetDir>/<archive>/`** is missing entirely and no timestamped fallback matches, cleanup still succeeds but emits **`no spec directory moved`**.

- If **`<targetDir>/completed/<archive>/`** already exists (or another filesystem guard trips), jarvis emits a descriptive warning while continuing other candidates and exits **non-zero only after exhausting the queue**.

`--abandon` flips cleanup to the inverse selector over the same `.worktree/` set.

- Eligible worktrees are those whose branch PR is **not merged** and has no
  open ready PR. Closed PR, absent PR, and one open draft PR qualify.
- Merged PRs stay for default cleanup. An open ready PR or multiple open
  matching PRs are skipped.
- On confirmation, jarvis closes the single matching open draft PR best-effort,
  force-removes the worktree, deletes the local branch, then deletes the remote
  branch. Missing remote branches are tolerated.
- `--abandon` never archives or deletes the source spec directory. The spec
  stays in place for a fresh `jarvis1 run`.

The `.worktree/.keep` directory is never removed.

## Triage

`jarvis triage [worktree-name]` is a read-only inspector for dirty or orphaned worktrees. Without an argument, it lists all worktrees with a one-line summary of each (dirty status, commits ahead/behind, PR state, spec progress). Given a worktree name, it prints a full drill-down including git state, spec progress, PR details, and suggested next moves. Useful when `jarvis run` bails due to a dirty worktree and you need to understand what work is in progress.

### Drill-down sections

The full report (`jarvis triage <worktree-name>`) includes six sections:

**Identity**: Worktree path, branch name, spec pointer (preferred: `.active-spec-path` referencing something like **`spec/2026-05-17T22-14-03Z-my-plan/index.md`** for current plan runs versus legacy **`spec/<plan-name>/index.md`**), active subspec when resolvable from that index path, namespace, and graceful fallback when `.active-spec-path` is unreadable/absent (“pre-marker” worktrees).

**Git**: Porcelain output (`git status --porcelain`), ahead/behind vs upstream (`git rev-list --left-right --count @{u}...HEAD`), unpushed commits (`git log @{u}.. --pretty`), and last commit with timestamp. Clean working trees print `(clean working tree)`. Missing upstream branch prints `(no upstream)`.

**Spec**: Task count (checked/total), first unchecked task (if incomplete), and unmet acceptance criteria for the active subspec (if it's an index spec). Degrades to `(spec unavailable)` if the spec marker is missing.

**PR**: PR state (`OPEN`, `DRAFT`, `MERGED`, `CLOSED`), URL, title, and last updated time. Falls back to `(no PR)` if no PR exists for the branch.

**Session log**: Absolute path to the most recent session log file for the worktree's namespace, plus the last 40 lines of that log (or all lines if shorter). Session logs are under `~/.jarvis/sessions/`. Prints `(no session logs found)` if none match the namespace.

**Suggested next moves**: Advisory shell commands keyed on the combination of dirty status, unpushed commits, PR state, and spec completion. Rules cover:

1. Clean working tree + unpushed commits + PR state in {none, DRAFT, OPEN} → `git push`
2. Clean working tree + merged PR → "Safe to remove with `jarvis cleanup`"
3. Untracked files (only in spec dir) → `git add <files> && git commit -m "seed spec"` then push
4. Dirty porcelain (`modified`/`mixed`/`untracked-only`) + merged PR → "Probably orphaned; inspect with `git diff` or discard with `jarvis1 cleanup`" (no stash prerequisite)
5. Modified/mixed changes + spec complete → "Commit and push the completed work"
6. Modified/mixed changes + spec incomplete → "Inspect, resume, or discard"
7. All other states → "Inspect with `git diff` and the session log above"

All suggestions are informational text only; nothing is executed by triage. Destructive commands like `--force` or `--no-verify` are never suggested (user types them explicitly if needed).
