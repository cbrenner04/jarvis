# 01 - Document committed-resume readiness recovery

## Problem

The current plan-mode documentation already says that committed plan mode opens
a draft PR and marks it ready automatically on success. That is directionally
correct, but it does not explain the recovery case that motivated this tree:
when a prior ready transition for a completed plan branch did not happen, a
later successful committed `jarvis plan --resume ...` run should retry the
transition only if the branch's open PR is still draft.

Without that wording, the docs either under-describe the supported recovery path
or risk overpromising a stronger background guarantee than the implementation
actually provides.

## Decisions

- Keep the user-facing contract attached to the existing trigger: Jarvis retries
  the ready transition only during a later successful committed resume run, not
  through a separate repair command or background scan.
- Describe already-ready PRs as a no-op during resume recovery so the docs match
  the intended idempotent helper behavior.
- Preserve the current gate in the docs: if `bun run ready` fails, the PR stays
  draft and the later successful retry path remains `jarvis plan --resume ...`.
- Update only plan-mode docs that currently promise automatic ready-on-success
  in a way that would be misleading once this recovery behavior is relied on.

## Tasks

- [ ] Update `docs/plan-mode.md` where it describes the plan PR lifecycle and
      auto-ready-on-success behavior so it mentions committed-resume recovery
      for still-draft PRs and the no-op behavior for already-ready PRs.
- [ ] Update other plan-readiness references that promise automatic
      `gh pr ready` behavior, such as `docs/run-loop.md`, `docs/config.md`,
      `docs/workflows.md`, or `docs/worktrees-and-commits.md`, only where the
      current wording would otherwise imply a broader guarantee than "retry on a
      later successful committed resume."
- [ ] Keep the documentation wording narrow: no claims about background repair,
      eventual consistency, or non-open PR handling.

## Documentation updates

- [ ] Ensure the updated docs consistently describe the trigger as a successful
      committed `jarvis plan --resume ...` completion when recovering a missed
      draft-to-ready transition.

## Acceptance criteria

- [ ] The plan-mode docs state that committed plan mode still marks draft PRs
      ready automatically on successful completion, including later successful
      committed resume runs when the branch's open PR is still draft.
- [ ] The docs state that an already-ready open PR is left untouched on resume
      rather than implying that Jarvis reruns the full ready gate every time.
- [ ] The docs preserve the existing gate semantics: if `bun run ready` fails,
      the PR remains draft and the recovery trigger is a later successful
      committed resume run.
- [ ] The updated wording does not promise any background repair loop or
      readiness changes for closed or merged PRs.
