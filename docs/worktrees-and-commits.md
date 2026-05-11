# Worktrees, commits, and pull requests

How `jarvis run` manages git state: worktree layout, resume guarantees, commit
shape, push cadence, and draft PR lifecycle.

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
- **Body**: a summary of the spec index and subspec H1 headings.
- **Base branch**: the branch detected by the first subspec.

The PR remains in draft until the spec is complete. If a PR already exists
(on resume), it is reused without modification to the body.

When the final subspec is completed and pushed, the draft PR automatically
transitions to ready for review (via `gh pr ready`). Jarvis never merges;
human reviewers are responsible for approval and merge decisions.

## Blocker handling

When a subspec cannot be completed (due to hook failure, ambiguity, or other
issues), the active agent appends a `## Blocker` section to the subspec
describing the problem, then commits and pushes as WIP. See
[../AGENTS.md](../AGENTS.md#working-rules-for-agents-in-this-repo) for the
blocker convention and resolution process.

## Cleanup

`jarvis cleanup [--dry-run]` removes merged worktrees and branches from the
local repo. Useful after PRs have been merged on GitHub to keep `.worktree/`
tidy.

Behavior:

- Lists all worktrees whose corresponding PR has `state: MERGED`.
- Skips worktrees with uncommitted changes or unpushed commits.
- Prompts for confirmation before removal (use `--dry-run` to preview).
- Removes the worktree directory and deletes the local branch.

The `.worktree/.keep` directory is never removed.
