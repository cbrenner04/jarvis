# Worktrees, commits, and pull requests

How `jarvis run` manages git state: worktree layout, resume guarantees, commit
shape, push cadence, and draft PR lifecycle.

> **Scope**: this document applies only when effective `git` is `true` (the
> default). When `git` is `false`, jarvis runs in
> [loop-only mode](./run-loop.md#loop-only-mode-git-false): no worktree is
> created, no commits or pushes happen, and no PR is opened or transitioned.

## Worktree layout

Spec runs create dedicated git worktrees under `.worktree/<spec-name>/`. The
`.worktree/` directory is tracked (via `.worktree/.keep`) so clones receive
it, but its contents are ignored in git — only `.keep` is committed.

The agent runs in the worktree, not the main checkout, so concurrent spec runs
(with different specs) do not interfere with each other.

After the worktree is ready, the worktree is the run source of truth. Jarvis
maps the requested spec path into that worktree and uses the worktree-local
spec for prompts, task banners, completion checks, and no-progress checks. If
the spec directory exists only in the main checkout, Jarvis seeds missing
spec files into the worktree without overwriting files already present there.
Those seeded copies are normal files in the worktree working tree: if they
are not yet on the feature branch, they start out **untracked** until you
`git add` and commit them.

Agents must leave the worktree **clean** (no uncommitted or untracked
changes) once every checkbox is checked, or `jarvis run` exits `6` instead of
treating the spec as complete — otherwise the harness can report "done" while
the draft PR never receives the work.

## Resume guarantees

When re-running a spec:

- **Worktree and branch both exist**: reuse both.
- **Worktree missing, branch exists locally or remotely**: recreate worktree
  on the existing branch.
- **Neither exist**: create new branch off the detected base branch and new
  worktree.

## Review-feedback worktrees

`jarvis1 review-feedback <worktree-name>` auto-materializes the patch worktree at
`.worktree/<worktree-name>/` from `origin/<worktree-name>` (or a local branch if no remote exists) when missing and `git: true` in config. In v1 it does not infer the target worktree from
the current working directory and does not support plan worktrees
(`plan-*` / `plan/<name>`). The target worktree must start clean (empty
`git status --porcelain`) before the review-feedback command proceeds.

## Commit shape

Each completed subspec produces exactly one commit. Jarvis creates the commit
itself (the agent should not run `git commit` during a subspec). The commit
subject is the subspec's H1 heading (the first `#` line), verbatim. The
commit body includes:

1. First line: `Spec: <relative path to subspec from repo root>`
2. A blank line
3. The verbatim `## Acceptance criteria` section from the subspec

The same commit also flips the index.md checkbox for the subspec from `[ ]`
to `[x]`, staging both the work and the index update together.

### Jarvis-Agent trailer

Every commit jarvis creates carries a `Jarvis-Agent: <label>` git trailer
at the end of the commit message. This applies to all three commit shapes
jarvis produces: subspec commits, `WIP:` progress commits, and `WIP:`
blocker commits.

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

Stamping `WIP:` commits as well as subspec commits keeps the data shape
uniform across every commit jarvis writes, even though the PR body
attribution footer only renders subspec commits.

## Push cadence

Each subspec commit is pushed immediately:

- **First commit**: `git push -u origin <branch>` (sets up tracking).
- **Subsequent commits**: `git push` (uses tracking from first push).

Push failures are errors that halt work; there is no automatic retry. This
keeps the draft PR synchronized with the latest commit, allowing reviewers
and CI to see incremental progress.

## Draft PR lifecycle

After the first successful subspec commit lands, `jarvis run` opens a draft
PR:

- **Title**: the H1 from the spec's `index.md` (e.g., "Git Workflow").
- **Body**: see [PR body](#pr-body) below.
- **Base branch**: the branch detected by the first subspec.

The PR remains in draft until the spec is complete. If a PR already exists
(on resume), it is reused without modification to the body.

When the final subspec is completed and pushed, the draft PR automatically
transitions to ready for review. The readiness transition begins with
`bun run ready`, which first runs `bun install --frozen-lockfile` so Biome is
available, then runs `bun run check:fix` (Biome's safe format and lint-rule
fixer). This may rewrite files before the rest of the ready gate
(`typecheck → test → check`) proceeds. The test phase runs `bun run test` (the
aggregate test command that covers all slices); see
[v2/docs/v1-behaviors.md#test-execution-and-development-workflows](v2/docs/v1-behaviors.md#test-execution-and-development-workflows)
for the test-command contract. If `check:fix` or any later step fails,
the PR remains in draft for manual correction.

If `check:fix` mutates any files, the harness creates and pushes a single
`chore: apply pre-ready check:fix` commit before proceeding further. This commit
is **not** a subspec commit (it has no `Spec:` body line) and is automatically
handled by the harness — operators do not need to manually commit or stash
anything. The commit is pushed immediately and becomes part of the branch.

After all readiness steps succeed (or in the case where `check:fix` caused no
mutations), the harness calls `gh pr ready`. Jarvis never merges; human
reviewers are responsible for approval and merge decisions.

### PR body

The PR body has three sections, in order:

1. **Deterministic header** generated by jarvis from `index.md`: the H1 only.
2. **Narrative section** bracketed by stable HTML-comment markers:

   ```
   <!-- jarvis:narrative:start -->
   …agent-authored summary…
   <!-- jarvis:narrative:end -->
   ```

   Reviewers may edit text *inside* the markers; jarvis preserves whatever
   lives between them on subsequent rewrites.
3. **Attribution footer** rendered from the `Jarvis-Agent` git trailers on
   the PR-branch subspec commits, separated from the body by a `---` rule.
   The footer is one compact deduped summary line:
   `Written by <Label A>, <Label B>, <Label C> through Jarvis.`
   preserving first-appearance order. When only one unique label is present
   the line collapses to `Written by <Label> through Jarvis.`. When no
   labelled subspec commits exist, the footer (and `---` separator) is
   omitted.

Reviewers may **not** expect edits to the deterministic header or footer to
survive a rewrite — those sections are regenerated from scratch.

#### Update cadence

The PR body is rewritten after every successful subspec commit, not only at
draft creation. The first subspec commit creates the draft PR; every
subsequent subspec commit pipes a freshly assembled body to
`gh pr edit <branch> --body-file -`. WIP commits do **not** trigger an
update. The draft-creation iteration itself does not run an extra update —
the create-time body already has the right shape — so each iteration calls
`gh pr edit` at most once.

Each rewrite fetches the current PR body, extracts the narrative section
between the markers (so reviewer edits inside the markers survive), rebuilds
the deterministic header from `index.md`, renders the attribution footer
from git trailers, and reassembles the body. If the markers are missing
(legacy PRs or manual edits removed them), the narrative section is omitted
on that update; it does not repopulate automatically.

If `gh pr edit` fails (network, rate-limit, permissions), jarvis emits a
`harness` warning to stderr naming the active subspec and continues the
iteration. The next successful subspec commit's rewrite naturally heals the
description, since both header and footer are rebuilt deterministically.

## Blocker handling

When a subspec cannot be completed (due to hook failure, ambiguity, or other
issues), the active agent appends a `## Blocker` section to the subspec
describing the problem, then commits and pushes as WIP. See
[../AGENTS.md](../AGENTS.md#working-rules-for-agents-in-this-repo) for the
blocker convention and resolution process.

## Plan-mode worktrees

Plan mode creates dedicated worktrees under `.worktree/plan-<plan-name>/` on a
`plan/<plan-name>` branch. The `plan-` prefix distinguishes plan-mode worktrees from
patch-mode worktrees (`.worktree/<name>/`) to prevent collision when both modes
target the same spec name.

During the intent-refinement phase, jarvis first uses a temporary slot:
`.worktree/plan-tmp-<short-uuid>/` on branch `plan/tmp-<short-uuid>`. After
the agent proposes a spec name and jarvis applies collision suffixing, jarvis
renames the worktree and branch to the final `plan-<plan-name>` / `plan/<plan-name>`
values before pushing. The temporary branch is never pushed to origin.

**Phase commits** in plan mode have special subjects:

- `plan: refine` — historical subject for the intent-refinement result:
  seeded `intent.md` from user input (file, inline, or no-argument mode), plus
  appended refinement/skip/blocker sections and the final proposed `name:` line
  after temp-slot rename.
- `plan: draft` — commits the initial agent-drafted spec tree.
- `plan: review N` — commits review-pass refinements to the same spec tree.
- `plan: blocker` — records a blocker raised during draft/review.
- `plan: refine r<n>` — records resume intent-refinement turns for resume run `n`.
- `plan: review N r<n>` — records resume review pass `N` for resume run `n`.
- `plan: blocker r<n>` — records a blocker raised during resume run `n`.

Push cadence follows the same pattern as patch mode: push after each commit.
The first push uses `git push -u origin plan/<plan-name>` to set up tracking;

later pushes use plain `git push`.


When every scripted phase succeeds, plan mode attempts a readiness transition (mirroring **`jarvis run`** readiness semantics):
- If the branch's open PR is **draft**, the `bun run ready` gate runs. On success, `gh pr ready` flips it to ready. On gate failure, the PR remains draft.
- If the branch's open PR is **already ready**, it remains untouched (idempotent).
- A later successful `jarvis plan --resume …` invocation retries the transition for still-draft PRs.

Encountering **`plan: blocker`** commits (or lingering blockers) stops before readiness—the PR stays draft until the blocker is cleared and **`jarvis plan --resume …`** succeeds.

## Cleanup

`jarvis cleanup [--dry-run]` removes merged worktrees and branches from the
local repo. Useful after PRs have been merged on GitHub to keep `.worktree/`
tidy. Patch-mode repos use **`.worktree/<spec-dir>/`**; plan branches use **`.worktree/plan-<plan-name>/`** (sans UTC prefix despite timestamped spec paths).
Both modes are handled on the same conditions.

Behavior:

- Lists all worktrees whose corresponding PR has `state: MERGED`.
- Skips worktrees with uncommitted changes or unpushed commits.
- Prompts for confirmation before removal (use `--dry-run` to preview with `(patch)` or `(plan)` tags).
- Removes the git worktrees and deletes the matching local branches. Branch
  deletion tries Git's safe `-d` path first, then force-deletes the local branch
  if Git rejects it as not fully merged. This handles squash-merged and
  rebase-merged PRs after the merged-PR, clean-worktree, unpushed-commit, and
  confirmation gates have already passed.

- Afterwards tries **`<targetDir>/<archive>/ → <targetDir>/completed/<archive>/`** using a filesystem `rename()` when **`<targetDir>/<archive>/`** exists. For patch layouts, **`<archive>`** is the branch/worktree name. For plan layouts, cleanup strips the **`plan/`** branch prefix (**`<archive> = plan-name`**) and uses the project's configured plan `targetDir` (default: `spec`).

- If the exact plan archive path is missing, cleanup also recognizes timestamped plan directories matching **`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/`** and moves the matched timestamped directory to **`<targetDir>/completed/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/`**.

- When that rename succeeds, cleanup creates and pushes a commit in the project root that stages only the moved spec paths.

- If **`<targetDir>/<archive>/`** is missing entirely and no timestamped fallback matches, cleanup still succeeds but emits **`no spec directory moved`**.

- If **`<targetDir>/completed/<archive>/`** already exists (or another filesystem guard trips), jarvis emits a descriptive warning while continuing other candidates and exits **non-zero only after exhausting the queue**.

The `.worktree/.keep` directory is never removed.

## Triage

`jarvis triage [worktree-name]` is a read-only inspector for dirty or orphaned
worktrees. Without an argument, it lists all worktrees with a one-line summary
of each (dirty status, commits ahead/behind, PR state, spec progress). Given a
worktree name, it prints a full drill-down including git state, spec progress,
PR details, and suggested next moves. Useful when `jarvis run` bails due to a
dirty worktree and you need to understand what work is in progress.

### Drill-down sections

The full report (`jarvis triage <worktree-name>`) includes six sections:

**Identity**: Worktree path, branch name, spec pointer (preferred: `.active-spec-path` referencing something like **`spec/2026-05-17T22-14-03Z-my-plan/index.md`** for current plan runs versus legacy **`spec/<plan-name>/index.md`**), active subspec when resolvable from that index path, namespace, and graceful fallback when `.active-spec-path` is unreadable/absent (“pre-marker” worktrees).

**Git**: Porcelain output (`git status --porcelain`), ahead/behind vs upstream
(`git rev-list --left-right --count @{u}...HEAD`), unpushed commits
(`git log @{u}.. --pretty`), and last commit with timestamp. Clean working
trees print `(clean working tree)`. Missing upstream branch prints
`(no upstream)`.

**Spec**: Task count (checked/total), first unchecked task (if incomplete),
and unmet acceptance criteria for the active subspec (if it's an index spec).
Degrades to `(spec unavailable)` if the spec marker is missing.

**PR**: PR state (`OPEN`, `DRAFT`, `MERGED`, `CLOSED`), URL, title, and last
updated time. Falls back to `(no PR)` if no PR exists for the branch.

**Session log**: Absolute path to the most recent session log file for the
worktree's namespace, plus the last 40 lines of that log (or all lines if
shorter). Session logs are under `~/.jarvis/sessions/`. Prints
`(no session logs found)` if none match the namespace.

**Suggested next moves**: Advisory shell commands keyed on the combination of
dirty status, unpushed commits, PR state, and spec completion. Rules cover:

1. Clean working tree + unpushed commits + PR state in {none, DRAFT, OPEN} → `git push`
2. Clean working tree + merged PR → "Safe to remove with `jarvis cleanup`"
3. Untracked files (only in spec dir) → `git add <files> && git commit -m "seed spec"` then push
4. Modified/mixed changes + merged PR → "Probably orphaned; inspect with `git diff` or discard with stash + cleanup"
5. Modified/mixed changes + spec complete → "Commit and push the completed work"
6. Modified/mixed changes + spec incomplete → "Inspect, resume, or discard"
7. All other states → "Inspect with `git diff` and the session log above"

All suggestions are informational text only; nothing is executed by triage. Destructive
commands like `--force` or `--no-verify` are never suggested (user types them explicitly
if needed).
