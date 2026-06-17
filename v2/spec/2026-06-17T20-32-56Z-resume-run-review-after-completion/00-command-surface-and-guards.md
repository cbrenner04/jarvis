# Review-resume command surface and guards

Pin the CLI entry for resuming a completed `jarvis1 run` spec into the
post-completion review phase, and the preflight guards that turn unsupported
conditions into clear operator errors before any agent runs.

This subspec covers only the command surface, argument parsing, and the four
preflight guards. The review execution behavior itself is subspec 01.

## Problem

Today `jarvis1 run` on an already-complete spec exits `0` with `spec complete`
and never enters the review phase, because the review phase is gated on the run
completing at least one implementation iteration (`run-loop.md` "Review phase";
`v1/src/modes/patch/run.ts` `tryFinishSpecIfDone`). An operator who wants to
re-run or retry review on a finished spec has no entry point.

Two existing-code facts shape the guards:

- The run resolution path does not detect a missing worktree — `ensureWorktree`
  (`v1/src/worktree.ts`) manufactures a fresh branch off the base branch and a
  new worktree when none exists, then continues. So "reject when no
  implementation PR exists" cannot be expressed as "let resolution fail"; it
  needs an explicit existence probe that runs *before* worktree
  materialization.
- A spec with unchecked tasks never reaches `tryFinishSpecIfDone`: the
  iteration routes to an implementation agent at the `before !== 0` branch
  (`run.ts` `runIteration`). So "review resume runs no implementation agent on
  an incomplete spec" must be enforced as a preflight guard here, not inside the
  execution path.

## Decisions

- Spell the entry as a `--resume-review` flag on `jarvis1 run`, not a new
  top-level subcommand and not `jarvis1 plan --resume`. Rules out: a separate
  `jarvis1 review` subcommand (duplicates run's repo resolution, worktree, and
  preflight surface) and overloading plan resume (the intent forbids it; plan
  resume targets `plan/<name>` spec PRs, not implementation PRs). This pins the
  intent's "Deferred to first consumer: exact CLI spelling".
- `--resume-review` resolves the target repo and spec via the existing
  `jarvis1 run` resolution path; it does not introduce a parallel resolver. The
  one sanctioned exception is a PR-existence probe (below) that runs before
  worktree materialization. Rules out a bespoke resolution path that could
  drift from `run`, while still letting the no-PR guard fire before
  `ensureWorktree` fabricates a worktree off base.
- The four guards are independent preflight checks; each stops with a distinct
  named message and exit code `1` (the existing "bad input / unsupported
  invocation" code), and runs no agent. Rules out silently no-opping to exit
  `0`, which would hide operator mistakes, and rules out a single conflated
  "no PR/worktree" message that cannot tell the operator which condition fired.
  The guards:
  - **review disabled** — `resolveReviewPasses` resolves to `0` (config or
    `--review-passes 0`).
  - **git off** — effective `git` is `false` (review's ready path needs `gh`).
  - **no implementation PR** — no remote branch backs a PR for the resolved
    spec's branch. PR existence (equivalently, a remote branch to back one) is
    the hard error; a missing-but-recreatable *local* worktree is **not** an
    error, because the review-to-ready path runs `gh pr ready` against a PR and
    the resolver can legitimately recreate the worktree from the remote branch.
    Rules out rejecting a normal completed spec whose local worktree was already
    cleaned up.
  - **incomplete spec** — the resolved spec still has unchecked tasks. Rules out
    falling through into an implementation agent under a flag whose contract is
    review-only.
- Guard order relative to the existing preflight: review-disabled and git-off
  may run early (no `gh` dependency); the no-PR guard depends on `gh` and runs
  *after* the existing `assertGhReady()` check and before `ensureWorktree`; the
  incomplete-spec guard runs once the spec path is resolved. Rules out probing
  for a PR before `gh` is confirmed available.
- `--max-iterations` is accepted but inert under `--resume-review`: review
  resume runs zero implementation iterations, so the value never bounds a loop.
  No parse error, no behavioral effect. This pins the intent's deferred
  `--resume-review` + `--max-iterations` question (the flag is parsed
  unconditionally today, so "inert" is the concrete contract, not a deferral).

## Tasks

- Parse `--resume-review` in the `run` arm of `parseArgs` and thread it to
  `runCommand` options.
- Add a PR-existence probe (remote-branch / PR presence for the resolved spec's
  branch) that runs after `assertGhReady()` and before `ensureWorktree`, used
  only by the `--resume-review` no-PR guard.
- Add the four `--resume-review` preflight guards, each rejecting with a
  distinct message and exit `1`: review passes resolve to `0`, effective `git`
  is `false`, no PR/remote branch exists, or the spec has unchecked tasks.
- Update `jarvis1 run` usage text to list `--resume-review`.

## Acceptance criteria

- [ ] `jarvis1 run --resume-review <spec-path>` is accepted by argument parsing and threads a review-resume signal into the run command.
- [ ] `jarvis1 run --resume-review` with review passes resolving to `0` (config or `--review-passes 0`) exits `1` with a message naming that review is disabled, and runs no agent.
- [ ] `jarvis1 run --resume-review` with effective `git` false exits `1` with a message naming that git mode is off, and runs no agent.
- [ ] `jarvis1 run --resume-review` when no implementation PR (no remote branch backing one) exists for the resolved spec exits `1` with a message naming the missing PR, and runs no agent.
- [ ] `jarvis1 run --resume-review` against a complete spec whose PR exists but whose local worktree is absent does not reject on worktree grounds; resolution proceeds (worktree may be recreated from the remote branch).
- [ ] `jarvis1 run --resume-review` on a spec with unchecked tasks exits `1` with a message naming that the spec is incomplete, and runs no agent.
- [ ] `jarvis1 run --resume-review --max-iterations <n>` is accepted and the value has no behavioral effect (review resume runs no implementation iterations).
- [ ] `jarvis1 run` usage/help text lists the `--resume-review` flag.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document `jarvis1 run --resume-review` — purpose, the
  four guard errors (review disabled, git off, no PR, incomplete spec) and that
  each exits `1`, the no-PR-but-recreatable-worktree distinction, guard ordering
  relative to `assertGhReady`/`ensureWorktree`, that `--max-iterations` is
  inert, and that it runs no implementation iterations. Cross-link the "Review
  phase" section. Add the four guard failures to the exit-code table under `1`.
- `README.md`: add `--resume-review` to the `jarvis1 run` command signature and
  one line describing review resume.
- `v2/docs/v1-behaviors.md`: extend the "Patch-mode review phase" entry to
  record that review can also be entered via `jarvis1 run --resume-review` on a
  completed spec, with the four guards (review disabled / git off / no PR /
  incomplete spec, each exit `1`).
