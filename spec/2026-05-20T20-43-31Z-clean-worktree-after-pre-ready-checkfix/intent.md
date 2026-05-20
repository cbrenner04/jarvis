---
name: clean-worktree-after-pre-ready-checkfix
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

Notes for the draft phase, gathered from a read-only pass of the harness:

### Plan mode has the same bug, and the same shape of fix applies

`maybeMarkPlanPrReady` in `src/modes/plan/pr.ts:255` is structured almost
identically to `maybeMarkReady` in `src/modes/patch/pr.ts:117`: its default
`markReady` callback first runs `execFileSync("bun", ["run", "ready"], ...)`
and then `gh pr ready <branch>`. Because both call sites share the same
`bun run ready` (which itself calls `biome check --write .` across the whole
repo), plan-mode draft→ready transitions are vulnerable to the exact same
"clean tree → dirtied by check:fix → silently left dirty (or fatally
blocked)" failure mode as patch mode. The intent says "Touching plan-mode
readiness behavior beyond what is required to keep the plan-mode draft→ready
path consistent with patch mode" is a non-goal, but pragmatically the two
paths *must* stay consistent. The draft should either:

1. Extract the "run ready, then commit-and-push any resulting diff, then
   `gh pr ready`" sequence into a single shared helper that both
   `maybeMarkReady` and `maybeMarkPlanPrReady` call, **or**
2. Implement it once for patch mode and explicitly document why plan mode
   is left as-is (with the residual risk that plan mode can still leave a
   dirty worktree behind on a ready transition).

Recommendation: option 1. Plan-mode worktrees are also git checkouts, the
same biome rules run, and operators see the same dirty `git status` after
ready. The cost of sharing one helper is small; the cost of letting the two
paths drift is the bug returning under a different name.

### The `markReady` test seam is the obvious injection point

Both `maybeMarkReady` and `maybeMarkPlanPrReady` already accept a
`markReady?: (branch, cwd) => void` test seam (see
`src/modes/patch/pr.ts:114` and `src/modes/plan/pr.ts:247`) whose default
implementation wraps both `bun run ready` and `gh pr ready` in one function.
The new "commit dirty tree between ready and gh pr ready" logic belongs
**inside that same default**, not in the caller in `src/modes/patch/run.ts`.
That keeps the test seam meaningful: existing tests that pass a stub
`markReady` continue to bypass the new behavior (they're testing the call
site, not the readiness internals), and new tests can exercise the default
implementation directly by calling `maybeMarkReady` without overriding
`markReady` and instead stubbing the lower-level git/gh boundaries (e.g.
via `pushCurrent` and the `git` / `gh` executables, or by splitting the
default into smaller seams: `runReady`, `commitPreReadyFixIfDirty`,
`markPrReady`).

The draft should pick whichever seam shape it prefers, but the call site in
`src/modes/patch/run.ts:1223` should stay a single `maybeMarkReady({ ... })`
invocation with no new arguments unless we genuinely need agent identity
plumbed through.

### Agent label for the `Jarvis-Agent` trailer

`maybeMarkReady` does **not** currently receive the active agent. The call
site at `src/modes/patch/run.ts:1223` passes only `{ indexPath, cwd }`. The
nearest `agent.attributionLabel()` is available in the same scope (see
`src/modes/patch/run.ts:1249` for `commitWipProgress`), so plumbing it
through is a one-line addition.

For plan mode, `attributionLabel` is similarly available wherever
`maybeMarkPlanPrReady` is called (search `src/modes/plan/` and
`src/commands/plan.ts:2334`).

The draft should pin down: the new commit gets a `Jarvis-Agent:` trailer
whose value is the **same `attributionLabel()` that would have been used
for the final subspec commit on that iteration**, not a synthetic
"harness" label. Rationale: the operator is the one who chose the agent
order; the trailer should reflect who was running. The fact that this
commit is harness bookkeeping is conveyed by the `chore:` subject and the
absence of a `Spec:` first body line, not by the trailer value.

### Attribution rendering: the existing filter already does the right thing

`readBranchCommits` in `src/pr.ts:125` reads commits with their
`Jarvis-Agent` trailers, but the per-commit attribution list in
`ensureDraftPr` (see `src/pr.ts` and `AGENTS.md` § "PR attribution")
**already filters to commits whose first body line begins with `Spec: `**
(see `SUBSPEC_FIRST_BODY_LINE_PREFIX` at `src/pr.ts:115`). A `chore:`
commit with no `Spec:` trailer in its body will therefore be omitted from
the per-commit list automatically.

That answers one of the intent's open questions: as long as the new commit
is written **without** a `Spec:` first body line (just `chore: ...` subject
+ `Jarvis-Agent:` trailer), no changes to `renderAttribution` or
`generatePrBodyFromSpec` are required for the per-commit list.

For the summary line (`Written by <Label> through Jarvis.`), the intent
asks the draft to commit to either "include this commit's label in the
summary" or "exclude it." Recommendation: **exclude it**, because the
summary is meant to credit the agents that wrote the subspec work, and
a harness-driven `biome check --write .` commit is not author work even
when an agent was last running. Concretely: the summary should be computed
from the same filtered set as the per-commit list (commits with a `Spec:`
first body line), not from the full set of `Jarvis-Agent`-trailered
commits. This is a small but real change to `renderAttribution` /
whatever helper builds the summary line — the draft must call this out
explicitly and add a test.

The alternative (include the label in the summary) is defensible but
makes the summary noisier in the common case where the last agent on a
PR is one nobody is paying attention to (e.g. a fallback agent that only
got to run because the primary was rate-limited and the chore commit ran
under it).

### Idempotency guard: the readiness loop, not check:fix's internals

The intent worries about `check:fix` producing a diff on a clean tree. In
practice the relevant invariant for *this* spec is narrower: after we
commit the post-ready dirty tree and re-invoke `bun run ready`, the
**second** run's `check:fix` step must not produce further diffs.

The draft should specify:

- After the post-ready chore commit, re-run `bun run ready` (or at least
  re-check `git status --porcelain`).
- If the tree is still dirty after exactly one retry, abort with a clear
  error referencing the branch and the dirty paths. Do **not** loop.
- `gh pr ready` is only called when the tree is clean after the (at most
  one) retry.

This bounds the worst case at "two `bun run ready` invocations per
readiness transition" which is acceptable given how rarely it triggers.

Cheaper alternative the draft should consider: instead of a second full
`bun run ready`, run only `bun run check:fix` a second time and check
`git status --porcelain`. That's enough to validate idempotency without
re-running typecheck/test/check, and it's what the original ordering
problem actually requires. The full second `bun run ready` is overkill
unless we suspect `check:fix` is interacting with files generated by
typecheck/test.

### `bun run check:fix` always exits 0 (modulo broken biome config)

Biome's `check --write .` writes fixes for safe rules and returns 0 even
when it rewrote files. That means `bun run ready` exits 0 *and* leaves the
tree dirty — the `markReady` default never sees a non-zero exit, so the
existing `try/catch` around `execFileSync("bun", ["run", "ready"])` is
silent. The draft must therefore not rely on `bun run ready`'s exit code
to detect dirtiness; it must run `git status --porcelain` explicitly
after `bun run ready` exits 0.

### Interaction with `tryFinishSpecIfDone`

The intent already notes this. Concretely: `maybeMarkReady` is called
inside the "completed subspec" branch in `src/modes/patch/run.ts:1223`
right before `subspecCompleted = true`. `tryFinishSpecIfDone` (called at
`src/modes/patch/run.ts:1297`) then runs `worktreeCompletionBlocker` (see
`src/worktree.ts:178`, which is `git status --porcelain`-based).

The ordering today is:

1. `commitSubspec` → push (clean tree)
2. PR body update
3. `maybeMarkReady` (which currently can dirty the tree)
4. `tryFinishSpecIfDone` → `worktreeCompletionBlocker` (sees dirt → exit 6)

The draft must guarantee that by the time step 4 runs, the tree is clean
again. With the fix inside `maybeMarkReady`'s default `markReady`, this
holds: the chore commit (when needed) lands and is pushed before
`maybeMarkReady` returns. No changes to the call-site ordering in
`run.ts` are required.

### Failure-mode matrix the draft should explicitly enumerate

The intent lists four scenarios in "Acceptance hints." Add two more that
fall out of the design above:

- (e) `bun run ready` exits 0 + clean tree → no chore commit, normal
  `gh pr ready` (regression case for the current happy path).
- (f) `bun run ready` exits 0 + dirty tree + second `check:fix` still
  dirty → no chore commit committed beyond the first attempt, no
  `gh pr ready`, exit with a clear "post-ready check:fix did not
  converge" error pointing the operator at the branch and the dirty
  paths.

Also worth a test, even if not in the matrix: dirty tree → chore commit
created → push fails with a transient network error. The harness should
**not** roll back the local commit (it's a valid commit; rolling it back
is racy and surprising). It should surface the push error and leave the
operator to `git push` manually and then re-run `jarvis run`, which on
the next pass should hit `tryFinishSpecIfDone` and finish cleanly because
the tree is already clean locally. The draft should explicitly say
whether re-runs are expected to be idempotent in this state (they are,
modulo PR readiness which `maybeMarkReady` will retry).

### `git: false` mode

Confirmed: with `git: false`, `maybeMarkReady` is never called from
`run.ts` because the surrounding block is gated on `gitEnabled` (see
`src/modes/patch/run.ts:1223`'s enclosing condition). The fix is
inherently a no-op for `git: false`; the draft just needs to state this
and not add any new git-shelling code paths that run unconditionally.

### Out of scope, but worth a one-line note in the draft

`scripts/ready.ts:94` is the *only* place `bun run check:fix` runs as part
of normal harness flow today. The intent's non-goal "Adding `check:fix`
to per-iteration commits, pre-commit hooks, …" is honored if and only if
the new chore commit's auto-creation logic lives in `maybeMarkReady` /
`maybeMarkPlanPrReady` and not in `commitSubspec` /
`commitWipProgress` / `commitWipProgressWithBlocker`. The draft should
restate this constraint verbatim so a reviewer can verify the diff
respects it.

## Refine turn 2

A second read-only pass tightened up a few claims in turn 1 and surfaced
one concrete simplification the draft should bake in.

### `renderAttribution` already filters the summary line — no change needed

Turn 1 said the summary line in `renderAttribution` is "a small but real
change" because it would otherwise include the chore commit's label. That
is wrong. Reading `src/pr.ts:235-267` directly: `renderAttribution`
filters `commits` down to `subspecCommits` (those whose `firstBodyLine`
starts with `Spec: `) **once**, at the top, and then computes **both** the
per-commit bullet list and the `labelOrder` that drives the `Written by
...` summary from that same filtered set. So as long as the chore commit
is written without a `Spec:` first body line, it is automatically excluded
from **both** the per-commit list and the summary line. No edits to
`renderAttribution`, `readBranchCommits`, or `generatePrBodyFromSpec` are
required for attribution to behave correctly.

That collapses one of the intent's open design questions ("include the
label in the summary or not") into a non-question: the existing filter
already excludes it, and that matches the recommendation in turn 1.
The draft should:

- State the contract for the chore commit precisely: subject `chore: apply
  pre-ready check:fix` (or whatever message the draft picks), an empty
  body **except** for a single `Jarvis-Agent: <attributionLabel>` trailer.
- Note that no changes to `src/pr.ts` are required for attribution.
- Still add a test under `test/pr.test.ts` (or wherever `renderAttribution`
  is covered) that asserts a `chore:`-subject, no-`Spec:`-line commit is
  omitted from both the bullets and the summary, so a future change to
  the filter does not silently start rendering chore commits.

### `bun run ready` runs `install --frozen-lockfile` first, then `check:fix`

`scripts/ready.ts:92-98` runs five commands in order: `bun install
--frozen-lockfile`, `bun run check:fix`, `bun run typecheck`, `bun run
test`, `bun run check`. Only `check:fix` mutates the tree under normal
operation; `install --frozen-lockfile` is, by definition, expected not to
modify `bun.lockb` (it fails if the lockfile would change). The other
three steps are read-only.

That means the cheaper-alternative idempotency check from turn 1 —
"re-run only `bun run check:fix` instead of all of `bun run ready`" — is
not just an optimization. It is also strictly *more correct* as a
convergence test for this specific bug: rerunning the read-only steps
adds nothing to the convergence guarantee, only latency. The draft
should pick the `bun run check:fix`-only retry and explicitly justify
not re-running `typecheck`/`test`/`check` (they did not produce the diff
and re-running them on the now-committed tree adds tens of seconds for
no informational value).

If the draft is worried about `bun install --frozen-lockfile` somehow
mutating files, that would be a separate bug (the lockfile is supposed to
be frozen). The chore commit fix should not try to absorb it. If
`bun install` ever produces a `bun.lockb` diff under `--frozen-lockfile`,
the right behavior is to fail loudly, not to auto-commit it.

### Test seam shape: split the default `markReady` into named helpers

Both `maybeMarkReady` (`src/modes/patch/pr.ts:117-162`) and
`maybeMarkPlanPrReady` (`src/modes/plan/pr.ts:255-292`) wrap two
side-effects (`bun run ready` and `gh pr ready`) inside a single
anonymous default for the `markReady` test seam. That seam is too coarse
to test the new behavior cleanly: a test that wants to verify "ready
ran, the tree was dirtied, a chore commit was created and pushed, then
`gh pr ready` was called" cannot easily stub just the `gh` call while
letting the new commit-and-push path run for real.

Concrete recommendation for the draft: factor the default body of
`markReady` into three named, exported helpers (either in
`src/modes/patch/pr.ts` and re-used from `src/modes/plan/pr.ts`, or
lifted into a new shared module — see next note):

- `runBunReady(cwd: string): void` — wraps the `execFileSync("bun",
  ["run", "ready"], …)` call and its current `try/catch` that surfaces
  stdout/stderr.
- `commitPreReadyFixIfDirty(opts: { cwd: string; agentLabel: string }):
  { committed: boolean; sha?: string }` — runs `git status --porcelain`,
  and if non-empty, runs `git add -A && git commit -m <message>` with a
  `Jarvis-Agent: <agentLabel>` trailer, then `pushCurrent({ cwd,
  firstPush: false })`. Returns whether it committed.
- `markPrReady(branch: string, cwd: string): void` — wraps the
  `execFileSync("gh", ["pr", "ready", branch], …)` call.

Then `maybeMarkReady`'s default becomes a thin sequencer:

```
runBunReady(cwd)
const first = commitPreReadyFixIfDirty({ cwd, agentLabel })
if (first.committed) {
  // idempotency check: a second check:fix must converge
  runCheckFixOnly(cwd)
  if (worktreeIsDirty(cwd)) {
    throw new Error("post-ready check:fix did not converge; …")
  }
}
markPrReady(branch, cwd)
```

`maybeMarkReady`'s signature gains exactly one new field: `agentLabel:
string` (sourced from `agent.attributionLabel()` at the call site in
`src/modes/patch/run.ts:1223`). The `markReady` seam stays in place for
callers that want to stub the whole thing (existing tests), but the new
helpers become independently testable.

### Shared helper between patch and plan modes

Turn 1 recommended sharing the "run ready → commit dirty → mark ready"
sequence between `maybeMarkReady` and `maybeMarkPlanPrReady`. The shape
above makes that almost free: `runBunReady`,
`commitPreReadyFixIfDirty`, `runCheckFixOnly`, `worktreeIsDirty`, and
`markPrReady` are all mode-agnostic and belong in a new module (e.g.
`src/pr-ready.ts`) or attached to `src/pr.ts`. Both `maybeMarkReady`
and `maybeMarkPlanPrReady` import them and compose the same sequence.

Where the two paths legitimately differ:

- `maybeMarkReady` is gated on `linkedSubspecsAreComplete(indexPath)`;
  `maybeMarkPlanPrReady` is gated on PR existence only. That stays
  inside each function and is unaffected by the shared helpers.
- `maybeMarkPlanPrReady` currently has callers that wrap with
  try/catch and warn-and-continue (per its docstring); `maybeMarkReady`
  rethrows. The shared helpers should not change either failure policy
  — they should throw on failure and let each caller decide whether
  to swallow.

### Where the `agentLabel` comes from for plan mode

Patch mode calls `maybeMarkReady` from `src/modes/patch/run.ts:1223`,
which has `agent.attributionLabel()` in scope (used a few lines later
for `commitWipProgress`). Plumbing `agentLabel` through is one line.

For plan mode, `maybeMarkPlanPrReady` is called from
`src/commands/plan.ts` (turn 1 cited the rough location). The exact
call site needs to be confirmed by the draft, but plan phases run
through wrappers that already have the active agent's label available
for commit-trailer purposes. The draft should:

1. Pin the call-site line in `src/commands/plan.ts` (or wherever
   `maybeMarkPlanPrReady` is invoked) at the time of writing.
2. Confirm `attributionLabel()` is reachable there. If it is not — e.g.
   the plan-mode readiness call lives in a code path that has rotated
   past the active agent — the draft must explicitly pick a fallback
   label (e.g. the label of the most recent plan phase agent, or a
   synthetic `jarvis-harness` label that is excluded from attribution
   summaries). It should not silently emit a `Jarvis-Agent: unknown`
   trailer.

### Convergence check: prefer `git status --porcelain` over re-running ready

The intent's idempotency guard discussed retrying `bun run ready` vs.
just `bun run check:fix`. The minimal correct check is even cheaper:
after `commitPreReadyFixIfDirty` returns `{ committed: true }`, the
local tree is already clean (the helper just committed everything
`git add -A` saw). The only remaining question is whether a *second*
`check:fix` would re-dirty the tree. So:

- Run `bun run check:fix` exactly once more.
- Run `git status --porcelain`. If empty → converged, proceed to
  `markPrReady`. If non-empty → error out with the dirty paths.

No third attempt, no loop. This is the bounded retry the intent asks
for, expressed as "one extra check:fix" rather than "one extra full
ready."

### Push failure on the chore commit: do not roll back, but do test it

Turn 1 said the harness should not roll back a chore commit whose push
failed. Concretely: `pushCurrent` in `src/worktree.ts:199-213` already
throws on push failure with stderr captured. If the chore commit's push
throws, `commitPreReadyFixIfDirty` should propagate that throw.
`maybeMarkReady` then skips `markPrReady` (control flow exits via the
exception). The local commit remains in the worktree's history; the
operator can `git push` manually and rerun `jarvis run`, which will
pass the completion blocker (clean tree) and re-enter `maybeMarkReady`,
which will:

1. Run `bun run ready` (clean tree → no diff → no second chore commit).
2. Skip `commitPreReadyFixIfDirty`'s mutating branch.
3. Push nothing new.
4. Call `gh pr ready` — which succeeds the second time around because
   the branch on origin now reflects the local state.

That re-entry is naturally idempotent and the draft should add a test
for it: simulate push failure on the first chore commit, then re-invoke
`maybeMarkReady` with the same worktree state and verify it reaches
`markPrReady` exactly once with no additional commit.

### Restating the in-scope constraint, verbatim

The non-goal from turn 1 / the intent stands and the draft must repeat
it: the new commit-creation logic must live in `maybeMarkReady` /
`maybeMarkPlanPrReady` (or in shared helpers they call), and it must
not be introduced into `commitSubspec`, `commitWipProgress`, or
`commitWipProgressWithBlocker` in `src/modes/patch/subspec.ts`.
`check:fix` continues to run only as part of `bun run ready` at the
draft-to-ready gate, exactly as the previous spec decided.

### Updated failure-mode matrix

Combining turn 1's matrix with the simplifications above:

- (a) Clean tree after `bun run ready` → no chore commit, normal
  `gh pr ready`. Regression-guard the happy path.
- (b) Dirty tree after first `bun run ready` → one chore commit, push,
  one extra `bun run check:fix`, clean → `gh pr ready` succeeds.
- (c) `bun run ready` itself throws (typecheck/test/check failure) →
  no chore commit, no `gh pr ready`, error surfaced exactly as today
  (regression guard, no behavior change).
- (d) Push failure on chore commit → no `gh pr ready`, error surfaced,
  local commit retained, re-running `jarvis run` recovers cleanly.
- (e) Dirty tree after first `bun run ready` + second `bun run check:fix`
  still produces a diff → no `gh pr ready`, error message names the
  branch and the dirty paths, exit non-zero. No third attempt.
- (f) `git: false` mode → `maybeMarkReady` is never called (already
  gated at `src/modes/patch/run.ts:1223`'s enclosing block). Document
  this; do not add new git-shelling under `git: false`.

### One open question for the draft to resolve

The intent leaves the chore commit's exact subject line as TBD. The
draft should pick one and stick with it; recommended: `chore: apply
pre-ready check:fix` (matches the language used throughout this intent
and is grep-friendly for operators investigating PR history). The body
should be empty except for the `Jarvis-Agent:` trailer. No `Spec:`
trailer. No co-authored-by. The draft should write the chosen subject
once and reuse it as a named constant (e.g. `PRE_READY_FIX_COMMIT_SUBJECT`
in `src/pr-ready.ts`) so tests and the implementation share the source
of truth.

## Refine turn 3

A third read-only pass confirmed turn 2's claims against the live code and
surfaced one plan-mode-specific edge case worth pinning down before drafting.

### Confirmed against current code

- `scripts/ready.ts:92-98` runs exactly the five commands turn 2 listed
  (`install --frozen-lockfile`, `check:fix`, `typecheck`, `test`, `check`),
  in that order. Only `check:fix` mutates the tree under normal operation.
- `src/modes/patch/pr.ts:131-160` is the anonymous `markReady` default that
  invokes `bun run ready` then `gh pr ready <branch>` with no dirty-tree
  handling between them. The shape matches the test seam analysis in turn 1.
- `src/modes/plan/pr.ts:262-291` is the structurally identical default in
  `maybeMarkPlanPrReady` — same two side-effects, same lack of
  dirty-tree handling. Sharing helpers between the two paths is still the
  right move.
- `src/commands/plan.ts:2330-2349` (`safeMarkPlanPrReady`) is the
  warn-and-continue wrapper around `maybeMarkPlanPrReady`. The active agent
  is not currently plumbed into this call site; the draft will need to
  thread `attributionLabel` through `safeMarkPlanPrReady` into
  `maybeMarkPlanPrReady`. Confirm the call chain leading into
  `safeMarkPlanPrReady` has the active agent in scope (it does for plan
  phases — each phase's agent is the one that just ran).
- `src/pr.ts:235-268` (`renderAttribution`) filters to `subspecCommits`
  whose `firstBodyLine` starts with `Spec: ` exactly once at the top and
  drives both the bullets and the summary from that filtered set. A
  `chore:` commit with no `Spec:` first body line is excluded from both
  automatically — no edits needed for patch-mode attribution.

### Plan-mode attribution is *not* a simple `Spec:`-prefix filter

Turn 2 assumed plan-mode attribution behaves the same way patch-mode does.
It doesn't. `src/modes/plan/pr.ts:90-146` defines its own filters
(`isPlanMetaCommit`, `isSubspecCommit`) that both require a `Spec: spec/...`
first body line and then discriminate on whether it points at `intent.md`
or a numbered subspec. `renderPlanAttribution` walks `groupMetaCommits`
(`src/modes/plan/pr.ts:119-146`) and only renders meta-commits and subspec
commits; the inner branches at `src/modes/plan/pr.ts:192-225` have no
terminal `else`, so any commit that is neither a plan meta-commit nor a
subspec commit is dropped from the bullets list. A `chore: apply pre-ready
check:fix` commit with no `Spec:` line falls into that silent-drop branch,
which is the behavior we want — *but only for the bullets*.

There is one real wart, though: `groupMetaCommits` only accumulates a
`metaGroup` while consecutive commits are meta-commits. A non-meta commit
in between flushes the current group and starts a fresh one. Concretely,
if a plan-mode flow ever produces this commit sequence on a branch
(e.g. across a `--resume` where review happens, ready dirties the tree,
then more refine/review runs):

```
plan: refine
plan: draft
plan: review 1
chore: apply pre-ready check:fix   <-- new, no Spec: line
plan: review 2 r1
```

…then `renderPlanAttribution` will emit **two** bullet lines of the form
`- 3 spec commits (refine, draft, review)` and `- 1 spec commits (refine,
draft, review)` instead of one collapsed `- 4 spec commits (...)` line.
The chore commit itself is correctly dropped, but it fragments the
grouping.

In the steady-state flow (`maybeMarkPlanPrReady` runs once at the very end
of plan mode, after the final review pass), this fragmentation can't
happen — there are no meta-commits after the chore commit. The bug is
only reachable via `plan --resume` where a previous run already created
the chore commit and the resume run produces new meta-commits afterward.
That is a real but narrow edge case.

The draft should:

1. State this as a known limitation explicitly, with the example above.
2. Either fix it in `groupMetaCommits` (easy: treat commits that are
   neither meta-commits nor subspec commits as transparent — skip them
   instead of flushing the meta-group) or accept it as a known wart and
   add a TODO test case that documents the cosmetic bug.
3. Prefer fixing it; the fix is one branch in `groupMetaCommits` and a
   targeted test, and it keeps plan-mode PR bodies clean across resume
   transitions.

The `Written by ... through Jarvis.` summary line in
`renderPlanAttribution` is already unaffected because the chore commit
contributes no agent label to `labelOrder` (it falls through the
`else if` chain at lines 211-225 without touching `seenLabels` or
`labelOrder`). No change needed to the summary line either way.

### Where `attributionLabel` enters plan mode

Patch mode call site: `src/modes/patch/run.ts` invokes `maybeMarkReady`
inside a block that has `agent.attributionLabel()` in scope (also used a
few lines later for `commitWipProgress`). The draft adds one field to
`MaybeMarkReadyOpts` (`agentLabel: string`) and passes
`agent.attributionLabel()` at the call site.

Plan mode call site: `safeMarkPlanPrReady` in `src/commands/plan.ts:2330`
is called from each plan phase wrapper. Those wrappers receive the active
agent for that phase (they already use it for commit attribution).
Concretely the draft must thread `agentLabel: string` through
`safeMarkPlanPrReady`'s `args` and through `MaybeMarkPlanPrReadyOpts` to
`maybeMarkPlanPrReady`'s default `markReady`. The draft should pin the
specific call sites in `src/commands/plan.ts` that need the new field
and confirm the active agent's label is available at each one. If any
call site cannot reach the active agent's label (e.g. a shutdown path),
the draft must pick a deterministic fallback (recommended: the label of
the most recent plan phase that ran successfully, captured once at the
top of the plan flow). It must not emit a `Jarvis-Agent: unknown`
trailer on the chore commit.

### Final non-goal restatement (verbatim, per intent's request)

> Adding `check:fix` to per-iteration commits, pre-commit hooks, or to
> `commitSubspec` / `commitWipProgress` / `commitWipProgressWithBlocker`
> in `src/modes/patch/subspec.ts`.

The chore-commit logic lives in `maybeMarkReady` /
`maybeMarkPlanPrReady` (or shared helpers in `src/pr-ready.ts`) and
nowhere else. `check:fix` continues to run only as part of
`bun run ready` at the draft-to-ready gate. The diff should add no new
`check:fix` invocations outside the readiness path.

### Drafting checklist (delta from turn 2)

Add these to the checklist of items the draft must explicitly resolve:

- Pin the exact `safeMarkPlanPrReady` call sites in `src/commands/plan.ts`
  that need `agentLabel` plumbed through, and verify the active agent is
  in scope at each one.
- Decide whether to fix the `groupMetaCommits` fragmentation wart now or
  defer it. Recommended: fix it (one branch, one test).
- Add a `renderPlanAttribution` test that asserts a `chore:`-subject,
  no-`Spec:`-line commit interleaved with meta-commits is omitted from
  bullets and from the summary, *and* does not split the meta-group.

## Blocker

Review and approve `spec/2026-05-20T20-43-31Z-clean-worktree-after-pre-ready-checkfix/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis plan --resume-draft spec/2026-05-20T20-43-31Z-clean-worktree-after-pre-ready-checkfix/intent.md`
