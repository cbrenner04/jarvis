# Review-resume command surface and guards

Pin the CLI entry for resuming a completed `jarvis1 run` spec into the
post-completion review phase, and the preflight guards that turn unsupported
conditions into clear operator errors before any agent runs.

This subspec covers only the command surface, argument parsing, and guard
decisions. The review execution behavior itself is subspec 01.

## Problem

Today `jarvis1 run` on an already-complete spec exits `0` with `spec complete`
and never enters the review phase, because the review phase is gated on the run
completing at least one implementation iteration (`run-loop.md` "Review phase";
`v1/src/modes/patch/run.ts` `tryFinishSpecIfDone`). An operator who wants to
re-run or retry review on a finished spec has no entry point.

## Decisions

- Spell the entry as a `--resume-review` flag on `jarvis1 run`, not a new
  top-level subcommand and not `jarvis1 plan --resume`. Rules out: a separate
  `jarvis1 review` subcommand (duplicates run's repo resolution, worktree, and
  preflight surface) and overloading plan resume (the intent forbids it; plan
  resume targets `plan/<name>` spec PRs, not implementation PRs). This pins the
  intent's "Deferred to first consumer: exact CLI spelling".
- `--resume-review` resolves the target repo, worktree, and spec via the
  existing `jarvis1 run` resolution path; it does not introduce a parallel
  resolver. Rules out a bespoke resolution path that could drift from `run`.
- Guard order is a preflight that runs before any review agent: review disabled
  (`resolveReviewPasses` is `0`), effective `git` false, or no existing
  implementation PR/worktree each stop with a distinct named error and non-zero
  exit. Rules out silently no-opping to exit `0`, which would hide operator
  mistakes.
- `--resume-review` does not require the spec to be complete-with-zero-unchecked
  to *parse*, but completion is asserted in the execution path (subspec 01); the
  flag itself is rejected only for genuine argument errors (missing spec path,
  combined with an incompatible flag if any). Deferred to first consumer:
  whether `--resume-review` may combine with `--max-iterations` — pin when a
  caller needs it (default: ignore `--max-iterations` under review resume since
  no implementation iterations run).

## Tasks

- Parse `--resume-review` in the `run` arm of `parseArgs` and thread it to
  `runCommand` options.
- Add a preflight in the patch run path that, when `--resume-review` is set,
  rejects with a distinct error + non-zero exit for each unsupported condition:
  review passes resolve to `0`, effective `git` is false, or no implementation
  PR/worktree exists for the resolved spec.
- Update `jarvis1 run` usage text to list `--resume-review`.

## Acceptance criteria

- [ ] `jarvis1 run --resume-review <spec-path>` is accepted by argument parsing and threads a review-resume signal into the run command.
- [ ] `jarvis1 run --resume-review` with review passes resolving to `0` (config or `--review-passes 0`) exits non-zero with a message naming that review is disabled, and runs no agent.
- [ ] `jarvis1 run --resume-review` with effective `git` false exits non-zero with a message naming that git mode is off, and runs no agent.
- [ ] `jarvis1 run --resume-review` when no implementation PR/worktree exists for the resolved spec exits non-zero with a message naming the missing PR/worktree, and runs no agent.
- [ ] `jarvis1 run` usage/help text lists the `--resume-review` flag.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document `jarvis1 run --resume-review` — purpose, the
  three guard errors, and that it runs no implementation iterations. Cross-link
  the "Review phase" section.
- `README.md`: add `--resume-review` to the `jarvis1 run` command signature and
  one line describing review resume.
- `v2/docs/v1-behaviors.md`: extend the "Patch-mode review phase" entry to
  record that review can also be entered via `jarvis1 run --resume-review` on a
  completed spec, with the disabled/git-off/no-PR guards.
