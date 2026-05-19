# 01 - Collect actionable PR review feedback and render the prompt

## Problem

The command is only useful if it hands the agent the right review context.
Naively dumping every historical PR comment will quickly become noisy on
long-lived branches, while REST-only review comment fetching cannot reliably
distinguish resolved from unresolved inline threads.

## Decisions

- Reuse `checkPrExists(branch, cwd)` to resolve the open PR number for the
  current branch. If no open PR exists, fail with a clear non-zero error and do
  not spawn an agent.
- Fetch actionable review payload behind helpers rather than inline shell
  strings in command flow. The implementation may place them in `src/gh.ts`,
  `src/pr.ts`, or a review-focused helper module, but the command should depend
  on named functions instead of raw `gh ...` calls scattered through the file.
- Inline review feedback must come from unresolved review threads, using
  GraphQL-backed data if needed to read thread resolution state while preserving
  comment context such as `path`, `line`, and diff snippets.
- Top-level PR conversation comments should be filtered to a deterministic
  review-round boundary instead of the entire issue-comment history.
  - v1 rule: include non-bot PR issue comments whose `createdAt` is at or after
    the most recent submitted PR review timestamp on that PR.
  - If the PR has no submitted reviews yet, include all non-bot PR issue
    comments.
- Skip bot-authored feedback (for example logins ending in `[bot]`) for both
  inline and top-level comments.
- If there are no actionable comments after filtering, exit `0` with a short
  "no open review comments" style message and do not spawn an agent.
- Render one review prompt that includes:
  - branch and PR identity
  - each actionable inline thread in chronological order, with file path, line,
    author, body, and enough diff context to orient the agent
  - each included top-level comment with author and body
  - explicit instruction that Jarvis owns the commit/push step
  - the same patch-mode rules content from `src/modes/patch/rules.md`

## Task Checklist

- [ ] Add helper(s) to resolve the open PR number and fetch actionable review
  feedback for that PR.
- [ ] Implement unresolved-thread filtering for inline review comments.
- [ ] Implement the submitted-review-timestamp filter for top-level PR
  conversation comments, including bot exclusion.
- [ ] Define review-comment data structures that capture the prompt inputs
  without coupling the command directly to GitHub JSON blobs.
- [ ] Add a prompt renderer that produces one stable prompt string for the
  review agent, including the patch-mode rules text.
- [ ] Add tests covering: no open PR, no actionable comments, resolved-thread
  exclusion, bot exclusion, top-level comment time filtering, and prompt
  rendering with inline plus top-level feedback.

## Acceptance criteria

- [ ] When the branch has no open PR, `jarvis review <worktree-name>` exits
  non-zero with a clear message and does not spawn an agent.
- [ ] Inline comments from resolved review threads are excluded from the agent
  prompt.
- [ ] Bot-authored inline and top-level comments are excluded from the agent
  prompt.
- [ ] Top-level PR comments older than the latest submitted review are excluded
  from the agent prompt; if the PR has no submitted review, non-bot top-level
  comments remain eligible.
- [ ] If no actionable comments remain after filtering, the command exits `0`
  with a "no open review comments" style message and does not spawn an agent.
- [ ] The rendered prompt includes branch/PR identity, actionable comment
  content, and the patch-mode rules while explicitly telling the agent not to
  commit.
- [ ] `bun run typecheck` and `bun test` pass after this slice lands.

## Documentation updates

- `docs/workflows.md`: add a short `jarvis review` workflow note explaining
  that Jarvis consumes open PR feedback from GitHub and runs one agent pass to
  address it.
- `docs/quota-signals.md`: only update if the implementation introduces any
  review-mode-specific wording that should match existing patch-mode quota or
  failure terminology.
