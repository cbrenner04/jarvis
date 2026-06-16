---
name: tmp-44d42f14-2
---

## Raw seed

<details>
<summary>Raw seed</summary>

<<<RAW_SEED_BEGIN>>>
---
name: resume-run-review-after-completion
---

## Intent

Allow an operator to resume a completed `jarvis1 run` spec so the post-completion review phase can run or retry without reopening implementation work.

## Prerequisites

- Patch mode already detects a complete spec and has a post-completion review phase.

## Behavior

- A completed spec can be resumed directly into the post-completion review workflow.
- Resume does not invoke implementation agents or require unchecked spec tasks.
- Resume preserves the existing draft PR/worktree semantics and retries the normal review readiness path.
- Resume remains a no-op or clear operator error when review is disabled, git mode is off, or no implementation PR/worktree exists.

## Decisions

- Resume targets completed specs instead of adding a synthetic unchecked review task; this rules out mutating spec acceptance state to drive harness-only review.
- Review resume is a patch-run workflow, not plan resume; this rules out overloading `jarvis1 plan --resume` for implementation PR review.
- Deferred to first consumer: exact CLI spelling for review resume — pin when command parsing and current flags are specified.


<<<RAW_SEED_END>>>

</details>

## Intent

Let an operator re-enter the post-completion review phase on an already-complete `jarvis1 run` spec, so review can run (or retry) without reopening implementation work. Today the review phase is skipped when a run "completed no implementation iterations" (see `v1/docs/run-loop.md` "Review phase"), so a spec that was already complete on entry — or whose review failed/blocked earlier — has no way to get reviewed.

## Prerequisites

- Patch mode already detects spec completion (zero unchecked boxes) and has a post-completion review phase: baseline gate → review passes → final ready (draft → ready).

## Behavior

- A completed spec can be resumed directly into the post-completion review phase, bypassing the "no implementation iterations" skip.
- Resume does not invoke implementation agents and does not require unchecked spec tasks.
- Resume reuses the existing implementation draft PR / worktree and retries the normal review readiness path (baseline gate → passes → `gh pr ready`).
- Resume is a no-op or clear operator error when review is disabled (`modes.review.passes == 0`), `git` is off, or no implementation PR/worktree exists.

## Decisions

- Resume targets completed specs instead of adding a synthetic unchecked review task — rules out mutating spec acceptance state to drive harness-only review.
- Review resume is a patch-run workflow, not plan resume — rules out overloading `jarvis1 plan --resume` for implementation PR review.

## Open questions

- Exact CLI spelling for review resume (flag vs. subcommand) — pin once command parsing and current `run` flags are specified.
- How resume discovers the existing PR/worktree for an already-complete spec (config lookup, branch convention, or operator-supplied).

