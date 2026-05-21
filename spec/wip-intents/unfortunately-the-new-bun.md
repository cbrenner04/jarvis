# `bun run check:fix` during readiness can dirty the worktree and trip the completion blocker

## Original request

> unfortunately, the new 'bun check:fix' run before 'bun ready' can add new
> changes to the branch and jarvis freaks out. 'spec checklists are complete,
> but the worktree is not clean (3 path(s)); uncommitted or untracked changes'

## What's happening today

A previous spec moved `check:fix` into `scripts/ready.ts` as the first command of
the `bun run ready` sequence (`install → check:fix → typecheck → test → check`).
See `scripts/ready.ts:94` and `spec/completed/2026-05-20T06-38-59Z-run-check-fix-before-commit/`.

`bun run ready` is invoked from `maybeMarkReady` in `src/modes/patch/pr.ts:117`
right after the final subspec commit lands and the PR body is updated. The
sequence per iteration is roughly:

1. Agent runs, ticks the last acceptance criterion.
2. Harness creates the final subspec commit and pushes it.
3. Harness regenerates the PR body and calls `maybeMarkReady`.
4. `maybeMarkReady` shells out to `bun run ready`, which runs `check:fix`
   **across the entire worktree** (`biome check --write .`).
5. `check:fix` rewrites previously-clean files (e.g. files Biome didn't like
   that nobody touched this iteration, or files the agent staged but didn't
   re-format), leaving them modified but uncommitted.
6. If `ready` happens to succeed end-to-end, `gh pr ready` runs and the dirty
   tree is silently left behind on the branch.
7. If `ready` fails (or on the next harness pass through `tryFinishSpecIfDone`
   in `src/modes/patch/run.ts:1501`), the harness sees a non-empty
   `git status --porcelain` and emits:

   > spec checklists are complete, but the worktree is not clean (N path(s));
   > uncommitted or untracked changes

   …and exits 6 instead of finishing the spec.

So `check:fix` is doing exactly what it was asked to do — mutating files — but
nobody owns those mutations. The completion-blocker check in
`src/worktree.ts:178` (`worktreeCompletionBlocker`) was written before
`bun run ready` was a mutating step. The two assumptions now contradict each
other.

## Why this is a real bug, not just noise

- Operators see the error, look at `git status`, find a Biome-style auto-format
  diff that nobody asked them to review, and have to manually commit (or stash
  and discard) it just to let Jarvis finish.
- The diff often touches files that the active subspec never mentioned, so the
  "fix" lands in the wrong commit and confuses the PR history.
- The error is fatal (exit 6), so the harness gives up on a spec that is
  otherwise complete — the worst possible time to bail.

## Goals

- After a successful `bun run ready` invocation, the patch worktree must be
  clean again before `gh pr ready` is called and before
  `tryFinishSpecIfDone` evaluates the completion blocker.
- Any file mutations produced by the `check:fix` step that runs inside
  `bun run ready` should be committed by Jarvis, not left dangling for the
  operator.
- Operators should not need to manually `git add`/`git commit` to recover
  from a normal readiness transition.
- The fix should be local to the readiness path. We do not want to re-open
  the broader "run `check:fix` before every patch-mode commit" design — that
  is tracked in `spec/completed/2026-05-20T06-38-59Z-run-check-fix-before-commit/`
  and the explicit decision there was to keep `check:fix` only at the
  draft→ready gate.

## Non-goals

- Changing what `check:fix` does, or removing it from `bun run ready`.
- Adding `check:fix` to per-iteration commits, pre-commit hooks, or to
  `commitSubspec` / `commitWipProgress` / `commitWipProgressWithBlocker` in
  `src/modes/patch/subspec.ts`.
- Touching plan-mode readiness behavior beyond what is required to keep the
  plan-mode draft→ready path consistent with patch mode.
- Changing the completion-blocker check itself
  (`worktreeCompletionBlocker`) into something looser. The blocker is a
  load-bearing safety net for unrelated cases (forgotten staged files,
  untracked artifacts) and should keep its current semantics.

## Rough shape of the fix (to be refined in the spec)

A few options the draft should weigh, not prescribe yet:

1. **Wrap `bun run ready` in a commit step.** Have `maybeMarkReady` (or a new
   helper it calls) detect a dirty worktree immediately after the
   `bun run ready` subprocess exits successfully, and, if dirty, run
   `git add -A && git commit -m "chore: apply check:fix before ready"`
   (message TBD, plus a `Jarvis-Agent` trailer matching the active agent
   label) and push, *before* calling `gh pr ready`.
2. **Split `check:fix` out of `bun run ready` and run it earlier in the
   harness,** so the harness can stage and commit its results alongside the
   final subspec commit instead of after it. This is more invasive and
   reopens the prior spec's design tradeoffs.
3. **Run `check:fix` first as its own harness step before `bun run ready`,**
   commit any resulting changes, then let `bun run ready` re-run `check:fix`
   as a no-op (idempotent) before the read-only checks.

Option 1 is the smallest change and keeps the existing `bun run ready`
contract intact for humans. Option 3 is essentially Option 1 plus pulling
the mutating step out into the harness directly. The draft should pick one,
explain why the other was rejected, and call out the idempotency
expectation for `check:fix` (running it twice in a row on a clean tree
should produce no diff; if that ever stops being true, the readiness loop
would loop forever and we need a guard).

## Other things the draft should pin down

- **Commit author/message.** What exactly should the auto-commit say? It is
  not a subspec commit, so the PR-body regeneration logic that consumes
  `Spec:` trailers (`generatePrBodyFromSpec` and the attribution footer
  logic described in `AGENTS.md`) needs to know to ignore it. We probably
  want a fixed message like `chore: apply pre-ready check:fix` and no
  `Spec:` trailer, but still a `Jarvis-Agent:` trailer so attribution is
  honest.
- **Push behavior.** The harness already pushes after every subspec commit
  via `pushCurrent` in `src/worktree.ts:199`. The new commit needs the same
  push so the PR reflects reality before `gh pr ready`.
- **Failure handling.** If the auto-commit or push fails, do not call
  `gh pr ready`. Surface the failure the same way `maybeMarkReady` already
  surfaces a `bun run ready` failure (captured stdout/stderr, thrown
  `Error`).
- **Interaction with `tryFinishSpecIfDone`.** Confirm that once the new
  auto-commit lands and is pushed, the next call to
  `worktreeCompletionBlocker(agentWorkingDir)` returns `undefined` so the
  harness can finish with exit 0 instead of exit 6. Add a test that
  exercises this path end-to-end (or as close to end-to-end as the existing
  test harness supports).
- **Idempotency guard.** If for some reason `check:fix` keeps producing a
  diff (broken rule, infinite-rewrite scenario), the harness should not
  loop forever. The draft should specify a small bounded retry (e.g. one
  retry, then give up with a clear error pointing the operator at the
  branch).
- **`git: false` mode.** With `git` disabled, none of this applies — there
  is no worktree to be dirty and no PR to mark ready. The draft should
  confirm the new behavior is a no-op in that mode.

## Documentation updates the draft should include

- `docs/worktrees-and-commits.md` — the draft PR lifecycle / readiness
  section should mention that the harness may create a single
  `chore: apply pre-ready check:fix` commit immediately before
  `gh pr ready` and that this commit is not a subspec commit.
- `docs/workflows.md` — the readiness boxes in the patch-mode and plan-mode
  diagrams should reflect the new "commit any `check:fix` diff, then
  `gh pr ready`" step.
- `docs/run-loop.md` — clarify that `tryFinishSpecIfDone`'s "worktree not
  clean" exit 6 is no longer expected on the normal readiness path and is
  reserved for genuinely unexpected dirty state.
- `AGENTS.md` — the "PR attribution" section should note that the
  `chore: apply pre-ready check:fix` commit is intentionally omitted from
  the per-commit attribution list (it is harness bookkeeping, not author
  work) but its `Jarvis-Agent` trailer still counts toward the summary
  line. Or, alternatively, that it is rendered with a distinct label.
  Either way the draft should commit to one and document it.

## Acceptance hints for the eventual subspec(s)

- A `jarvis run` against a spec whose final subspec triggers `check:fix`
  rewrites must end with exit 0, a clean worktree, a PR that is `ready`
  (not draft), and one extra commit on the branch whose subject matches
  the chosen `chore:` message.
- Running `jarvis run` again on the same finished spec must still report
  "spec complete" and exit 0 (idempotent).
- Tests in `test/modes/patch/` (or wherever `maybeMarkReady` is already
  covered) exercise: (a) clean tree after `ready` → no extra commit;
  (b) dirty tree after `ready` → exactly one `chore:` commit + push;
  (c) `bun run ready` failure → no `chore:` commit, no `gh pr ready`,
  error surfaced; (d) push failure on the `chore:` commit → no
  `gh pr ready`, error surfaced.
