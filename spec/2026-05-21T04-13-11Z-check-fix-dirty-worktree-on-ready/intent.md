---
name: check-fix-dirty-worktree-on-ready
---

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

## Refine turn 1

### Confirmed Option 1 is correct; implementation details pinned

Repo exploration confirms Option 1 is the right approach. Key findings:

**`maybeMarkReady` is in `src/modes/patch/pr.ts:117`.** It has no imports from `src/worktree.ts` or `src/commit-trailer.ts` today. The fix must add those imports (or inline equivalents). `pushCurrent` lives in `src/worktree.ts:199` — it is already used in `run.ts` for every other commit/push pair and should be reused here.

**The `markReady` seam wraps `bun run ready` + `gh pr ready` together.** To make the auto-commit logic independently testable, the seam needs to be split or a new seam must be added. The cleanest approach: keep `markReady` as the full-sequence seam for the happy path, and add a dedicated seam for the post-`bun run ready` dirty-check-and-commit step (e.g. `commitCheckFix?: (cwd: string, agentLabel: string) => void`). Existing tests that use `markReady` remain valid unchanged.

**`agentLabel` must flow into `maybeMarkReady`.** The auto-commit needs a `Jarvis-Agent:` trailer (using `appendAgentTrailer` from `src/commit-trailer.ts`). `maybeMarkReady` is called at `run.ts:1223` inside the `gitEnabled && !opts.skipGhCheck` block, where `agent.attributionLabel()` is already available. Add `agentLabel?: string` to `MaybeMarkReadyOpts`; default to `""` if absent (which skips the trailer per `appendAgentTrailer`'s existing behavior).

**The call site in `run.ts:1223` must pass `agentLabel`:**
```ts
maybeMarkReady({
  indexPath: specPath,
  cwd: agentWorkingDir,
  agentLabel: agent.attributionLabel(),   // new
});
```

**Attribution exclusion is automatic.** `AGENTS.md:63` confirms that only commits whose first body line begins with `Spec:` appear in the per-commit attribution list. The `chore: apply pre-ready check:fix` commit has no `Spec:` body line and will be silently excluded. No special filtering logic is needed; just document this in AGENTS.md.

**`git: false` path is already safe.** `maybeMarkReady` is only called inside the `if (gitEnabled && !opts.skipGhCheck)` block in `run.ts:1152`, so the new commit/push logic never executes when git is disabled. No additional guard needed.

**Idempotency guard — simpler than described in the intent.** Since `bun run ready` is called exactly once and `check:fix` runs as a sub-step inside it, there is no retry loop. The guard needed is: after committing the `check:fix` diff, call `git status --porcelain` once more. If still dirty (meaning `bun run ready` produced additional mutations *after* `check:fix` ran, which should never happen but is a safety net), fail with a clear error message naming the branch and listing the unexpected dirty paths. Do not retry `bun run ready`. One check is sufficient.

**Sequence inside the real `markReady` function (replacing the lambda in `pr.ts:133`):**
1. Run `bun run ready`; capture failure and throw (existing behavior).
2. Check `git status --porcelain` in `cwd`.
3. If dirty: run `git add -A`, then `git commit -F -` with message `chore: apply pre-ready check:fix\n\n<Jarvis-Agent trailer>`.
4. Re-check `git status --porcelain`; if still dirty, throw a clear error (do not call `gh pr ready`).
5. Run `pushCurrent({ cwd, firstPush: false })` (branch already has upstream at this point — the final subspec commit was pushed moments before).
6. Run `gh pr ready <branch>` (existing behavior).

**Tests to add in `test/modes/patch/pr.test.ts`** using the new `commitCheckFix` seam:
- (a) `markReady` seam called, `commitCheckFix` not called → clean tree, no commit.
- (b) `markReady` seam replaced by separate `runReady` + `commitCheckFix` seams, dirty after `runReady` → `commitCheckFix` called with correct `cwd` and `agentLabel`.
- (c) `runReady` throws → `commitCheckFix` not called, error propagates.
- (d) `commitCheckFix` throws → `gh pr ready` not called, error propagates.

**Documentation files to update** (per intent): `docs/worktrees-and-commits.md`, `docs/workflows.md`, `docs/run-loop.md`, `AGENTS.md`. The draft should include a subspec for these doc updates, either bundled with the implementation subspec or as a separate trailing subspec.

## Refine turn 2

### Seam design clarified: three-way opt-in, not two-way

Refine turn 1 describes a `commitCheckFix` seam but leaves ambiguous how it interacts with the existing monolithic `markReady` seam. Code inspection of `pr.ts:108-161` and `test/modes/patch/pr.test.ts:285-354` confirms the resolution:

The type should have **three independent seams**, with `markReady` as a short-circuit override:

```ts
export type MaybeMarkReadyOpts = {
  indexPath: string;
  cwd: string;
  agentLabel?: string;                                         // NEW
  checkPrExists?: (branch: string, cwd: string) => boolean;
  /** Short-circuit: stubs the entire bun-run-ready + auto-commit + gh-pr-ready sequence. Existing tests use this. */
  markReady?: (branch: string, cwd: string) => void;
  /** Seam for just the `bun run ready` subprocess. Used in new tests when markReady is absent. */
  runReady?: (cwd: string) => void;
  /** Seam for the dirty-check-and-commit step. Called only when markReady is absent and tree is dirty. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
};
```

When `markReady` is provided it still short-circuits everything (existing test behavior is unchanged). When it is absent, the real implementation uses `runReady ?? realBunRunReady` then `commitCheckFix ?? realCommitCheckFix` then `gh pr ready`. Tests (a)–(d) from Refine turn 1 map cleanly: (a) uses `markReady` seam (clean, no `commitCheckFix`); (b) uses `runReady` + `commitCheckFix` seams with `markReady` absent; (c) `runReady` throws, `commitCheckFix` not reached; (d) `commitCheckFix` throws, `gh pr ready` not reached.

### Git command patterns confirmed from `subspec.ts`

The exact pattern used by every other harness commit (`commitSubspec`, `commitWipProgress`, etc.) is:

```ts
execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
execFileSync("git", ["commit", "-F", "-"], {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  input: commitMessage,   // piped via stdin, matching appendAgentTrailer output
});
```

The `commitCheckFix` default implementation should follow this exact pattern (not shell-out via a combined command string). `pushCurrent` from `src/worktree.ts:199` with `{ firstPush: false }` follows immediately after the commit.

### `runReady` seam signature: `cwd` only, not `(branch, cwd)`

The existing `markReady` seam signature is `(branch, cwd)` because it also calls `gh pr ready <branch>`. The new `runReady` seam only shells out to `bun run ready` inside `cwd`; branch is irrelevant. Signature: `(cwd: string) => void`. The `gh pr ready <branch>` call remains in the outer `maybeMarkReady` body (not inside any seam), unchanged from today.

### `commitCheckFix` seam covers commit + push together

The seam should wrap both `git add -A && git commit` and `pushCurrent` as a single unit. This makes test case (d) — "push failure → no `gh pr ready`" — cleanly testable by having the seam throw, without needing a separate push seam. The real default for `commitCheckFix` runs: add → commit → re-check porcelain (throw if still dirty) → `pushCurrent`.

### Subspec structure recommendation

Two subspecs is the right split:

- `00-implementation.md` — changes to `src/modes/patch/pr.ts`, `src/modes/patch/run.ts`, and `test/modes/patch/pr.test.ts`. This is the load-bearing piece and should be implemented first.
- `01-docs.md` — updates to `docs/worktrees-and-commits.md`, `docs/workflows.md`, `docs/run-loop.md`, and `AGENTS.md`. Can run after `00` is merged, references stable APIs.

## Refine skip

Code inspection confirms all implementation details from Refine turns 1 and 2 are accurate against the current source. The three-seam type design, git command patterns, `agentLabel` threading, `git: false` guard, and two-subspec split are all ready for drafting with no further refinement needed.
