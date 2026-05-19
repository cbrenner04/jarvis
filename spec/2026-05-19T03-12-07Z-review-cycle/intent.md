---
name: review-cycle
---
need to add a review cycle to jarvis

pulls the branches PR, addresses comments, commits and pushes - should this be a v2 spec? I could use this today. 

## Refine turn 1

### Scope decision: v1, not v2

The v2 rewrite is architectural and long-horizon; it should not block a workflow the user wants today. This feature fits naturally in v1's existing structure (new subcommand + new `src/modes/review/` or `src/commands/review.ts`), and the v2 vision doc treats `review` as an operation, not a rewrite prerequisite. Implement in v1.

### Command surface

New subcommand: `jarvis review [<worktree-name>]`

- With a worktree name: operates on `.worktree/<name>/`. Reads `.active-spec-path` to infer the branch.
- Without an argument: infers the worktree from `cwd` (walking up to find a `.worktree/` parent), similar to how cleanup works.
- Entry: new `src/commands/review.ts` registered in `src/cli.ts` alongside `run`, `triage`, `plan`, etc.

### Core workflow

1. Resolve worktree → branch name (`git rev-parse --abbrev-ref HEAD` in the worktree).
2. Fetch the open PR for that branch via `gh pr view <branch> --json number,url,comments,reviewThreads`.
3. Collect unresolved review threads (inline comments) and top-level PR comments. Skip already-resolved threads.
4. If there are no unresolved comments, exit 0 with a message ("no open review comments").
5. Build a prompt that includes: the full comment threads (with file path, line, and body), instructions to address each comment, and the Jarvis rules (same `rules.md` the patch mode uses).
6. Spawn an agent via the existing `createAgent` / `agentOrder` infrastructure (reuse `modes.patch.agentOrder` config key — no new config needed).
7. After the agent exits cleanly, commit any changes (`git add -A && git commit -m "address PR review comments"`), then push.
8. If the agent exits non-zero or no changes were made, emit a warning and exit non-zero; do not commit.

### What to fetch from the PR

Use `gh api` to get review threads with context:
- `gh api repos/{owner}/{repo}/pulls/{number}/comments` — inline diff comments (with `path`, `line`, `body`, `diff_hunk`).
- `gh api repos/{owner}/{repo}/issues/{number}/comments` — PR-level (non-inline) comments.
- Filter: skip comments whose thread has `resolved: true` (for review threads) or that are authored by bots (e.g. `[bot]` suffix).

### Prompt shape

Pass to the agent:
- A header explaining the task ("Address the following PR review comments on branch `<branch>`").
- Each comment rendered as: file path + line (if inline), author, body, and the surrounding diff hunk.
- Explicit instruction: "For each comment, make the requested change. Commit nothing yourself — the harness will commit after you exit."
- The Jarvis rules from `src/modes/patch/rules.md`.

### Commit message

Use a fixed message: `"address PR review comments"`. Optionally append `(PR #<number>)`.

### Error/edge cases

- No open PR for the branch → exit 1 with a clear message.
- No unresolved comments → exit 0, no agent spawn.
- Agent exits non-zero → do not commit; print agent stderr; exit 1.
- No disk changes after agent → warn ("agent made no changes") and exit 1.
- `gh` not available → same error path as existing `assertGhReady` check.

### Files to create/modify

- `src/commands/review.ts` — new, main command logic.
- `src/cli.ts` — register `review` subcommand, add to help text, parse args.
- `src/modes/review/` (optional) — if the prompt builder or comment fetcher grows large enough to warrant a subdirectory. Can start flat in `src/commands/review.ts` and extract later.

### Not in scope

- Resolving threads after addressing them (would require `gh api` PATCH; keep it simple for v1).
- Iterating the agent multiple times per run (single pass, single commit).
- New config keys (reuse `modes.patch.agentOrder`).
- Spec file updating (this is not spec-driven work).

## Refine turn 2

### Harness integration choices to make explicit

This repo already has most of the plumbing `review` needs, but it lives in patch-mode helpers rather than a generic command framework. The future spec should decide whether `jarvis review` is just a new command that reuses shared preflight/worktree helpers, or a small new mode with its own lifecycle. In practice, v1 should reuse:

- `runSharedPreflight` for project resolution and log-server readiness.
- `assertGhReady` for the existing `gh` auth/install failure path.
- existing worktree conventions (`.worktree/<name>`, `git rev-parse --abbrev-ref HEAD`, `pushCurrent`, lock acquisition) rather than open-coding git/gh behavior.

If `review` bypasses that lifecycle entirely, it will drift from `run` on logging, lock safety, and agent fallback behavior.

### Worktree scope should stay patch-focused in v1

The named-form/no-arg-form idea is good, but the draft should bound it to normal patch worktrees first. Plan-mode worktrees use `plan/<name>` branches and `spec/<timestamp>-<name>/` directories; they are a different workflow and do not match “address PR review on an implementation branch” cleanly. A good v1 boundary is:

- supported: `.worktree/<feature-name>/` patch worktrees with an open PR on branch `<feature-name>`
- out of scope: `plan-*` worktrees and detached/manual directories that are not under the repo’s `.worktree/`

Also, `.active-spec-path` is useful for triage context, but branch identity should come from git, not from the marker file.

### PR comment retrieval needs one concrete API decision

There is already a `checkPrExists(branch, cwd)` helper that finds the open PR number for a branch via `gh pr view`; the draft should reuse that instead of discovering PR identity a second way. After that, comment collection needs a sharper decision than the current intent gives:

- REST pull-request comments are a good source for `path`, `line`, and `diff_hunk`.
- unresolved-thread filtering may need GraphQL rather than plain REST, because “thread resolved vs unresolved” is thread state, not just comment state.

So the draft should either:

- choose a GraphQL-backed unresolved-thread fetch as the correct v1 implementation, or
- explicitly relax the behavior to “all non-bot review comments on the open PR” and accept that it may include already-resolved inline discussion.

Given the user wants to use this day-to-day, the first option is the better product boundary.

### Agent and commit behavior should mirror patch-mode safety

The current intent describes “spawn one agent, then commit and push”, but this repo already treats agent selection as an ordered fallback chain from `modes.patch.agentOrder`. The draft should preserve that behavior instead of hard-coding a single agent invocation. It should also spell out the safety gates:

- only commit when the agent exits successfully and `git status --porcelain` shows real changes
- use a fixed harness-authored commit message; the agent should not commit
- push with the existing `pushCurrent` helper so first-push upstream setup matches other commands
- exit non-zero on agent failure, quota exhaustion, push failure, or clean worktree after the run

### Deliberate non-goals for the first spec

To keep the spec atomic, v1 should avoid any PR-body or thread-state mutation beyond pushing code. That means:

- no auto-resolve of review threads
- no `gh pr comment` replies summarizing what changed
- no PR body refresh / attribution footer changes
- no spec-awareness beyond optional context in the prompt

## Refine turn 3

### Current-codebase constraint: no shared "resolve worktree from cwd" helper exists yet

The no-argument form is still reasonable, but it is not free. Today `triage` lists all worktrees when called without a name; `cleanup` also operates from the repo root; neither command has a reusable helper that walks upward from `cwd` and proves "you are inside `.worktree/<name>`". The draft should explicitly budget one of these two approaches:

- either keep v1 narrow and support only `jarvis review <worktree-name>`
- or include a small shared helper that resolves the current patch worktree directory and rejects `cwd`s outside `.worktree/<name>/`

What should not happen is a hidden third path where `review` open-codes its own cwd walk while `triage`/`cleanup` continue using separate logic.

### Safety boundary: fail on pre-existing dirty state before fetching comments

Patch mode assumes Jarvis owns the worktree lifecycle. `review` is more likely to be run manually against a branch the user has already touched, so the draft should decide this up front. Recommended v1 behavior:

- if `git status --porcelain` is non-empty before the agent runs, exit non-zero and tell the user to commit, stash, or inspect with `jarvis triage <worktree-name>`
- only evaluate "agent made no changes" against a worktree that started clean

Without this gate, the harness cannot distinguish "agent addressed review comments" from "there were already unrelated local edits", and the fixed commit message becomes misleading.

### Comment scope should favor actionable reviewer input, not every historical note

The intent already prefers unresolved GraphQL threads for inline review comments. The draft should make the same narrowing decision for top-level conversation comments: fetch PR issue comments, but only pass comments that are plausibly open review asks rather than the entire lifetime conversation. A workable v1 rule is:

- include unresolved inline review threads
- include non-bot top-level PR comments newer than the last harness-authored subspec commit, or newer than the most recent review submission if that is easier to query consistently

If the draft instead includes every historical top-level comment, daily use will degrade quickly on long-lived PRs because resolved or obsolete asks keep getting re-sent to the agent.

### Implementation seam: keep `gh` access behind helpers, not inline shell strings in the command

Existing code already centralizes some GitHub behavior in `src/gh.ts` and PR lookup in `src/pr.ts`. The draft should preserve that shape by making `review` depend on small helpers such as:

- "get open PR number for branch" via existing `checkPrExists`
- "fetch unresolved review payload for PR N"
- "render review prompt from fetched comments"

Whether the unresolved-thread fetch lands in `src/gh.ts`, `src/pr.ts`, or a new `src/commands/review.ts` local helper block is less important than avoiding raw `execSync(\"gh ...\")` calls scattered through command flow. That keeps error translation, tests, and future reuse tractable.
