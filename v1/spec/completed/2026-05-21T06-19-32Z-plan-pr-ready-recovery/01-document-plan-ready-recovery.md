# 01 - Document committed-resume readiness recovery

## Problem

The docs already describe the normal committed plan lifecycle: Jarvis opens a
draft PR while authoring the spec and marks it ready automatically when the
plan finishes successfully. What they do not explain is the recovery case that
motivated this tree:

- if the branch PR is still draft because an earlier ready transition failed,
  was skipped, or did not stick, a later successful committed
  `jarvis plan --resume ...` run should retry that transition;
- if the branch PR is already ready, that same resume path should do nothing;
- if the ready gate fails again, the PR stays draft and the recovery trigger
  remains a later successful committed resume run.

Without that wording, the docs either under-describe a supported recovery path
or imply a broader "Jarvis eventually repairs PR readiness on its own" promise
that this work does not introduce.

## Decisions

- Keep the user-facing contract tied to the existing trigger: Jarvis retries
  the transition only during a later successful committed resume run.
- Describe already-ready PRs as untouched on resume so the docs match the
  idempotent helper behavior.
- Preserve the current gate semantics in the docs: a failed `bun run ready`
  leaves the PR draft.
- Limit documentation changes to pages that currently describe the committed
  plan PR lifecycle or otherwise imply automatic `gh pr ready` behavior.

## Task Checklist

- [ ] Update [docs/plan-mode.md](../../docs/plan-mode.md) where it describes
  the committed plan PR lifecycle so it mentions resume-based recovery for
  still-draft open PRs and the no-op behavior for already-ready open PRs.
- [ ] Update [docs/run-loop.md](../../docs/run-loop.md) anywhere it currently
      implies that successful plan completion always performs a fresh
      draft-to-ready transition instead of allowing for the resume recovery
      path.
- [ ] Review other lifecycle docs that mention committed plan PR readiness,
      such as [docs/worktrees-and-commits.md](../../docs/worktrees-and-commits.md),
      and update them only if their current wording would overpromise anything
      beyond "retry on a later successful committed resume."
- [ ] Keep the wording narrow: no claims about background repair, eventual
      readiness, or behavior for closed or merged PRs.

## Documentation updates

- [ ] Ensure every updated page describes the recovery trigger as a successful
      committed `jarvis plan --resume ...` completion and keeps the already-ready
      path as a no-op.

## Acceptance criteria

- [x] The plan lifecycle docs state that committed plan mode still marks draft
  PRs ready automatically on successful completion, including later
  successful committed resume runs when the branch's open PR is still draft.
- [x] The docs state that an already-ready open PR is left untouched on resume
  rather than implying that Jarvis reruns the full ready gate every time.
- [x] The docs state that if `bun run ready` fails, the PR remains draft and
  the retry path is a later successful committed resume run.
- [x] The updated wording does not promise any background repair loop or
  readiness changes for closed or merged PRs.
- [x] Documentation changes are limited to pages that already describe the
  committed plan PR lifecycle or would otherwise misstate this recovery
  contract.
