# triage mark-ready pushes branches without upstream

## Problem

`jarvis1 triage <worktree> --mark-ready` can create a finalize commit and then
fail to push when the implementation branch has no upstream.

Observed on branch
`2026-06-29T05-58-11Z-plan-generated-spec-markdown-passes-lint-md-2` after a
manual acceptance-criterion tick:

```text
triage --mark-ready: failed to push finalize commit
fatal: The current branch ... has no upstream branch.
```

This leaves a valid finalize commit stranded locally and requires a manual
`git push --set-upstream`.

## Desired behavior

When `triage --mark-ready` finalizes a worktree whose branch has no upstream, it
should push with upstream setup automatically, then continue the normal ready
promotion flow.

## Decisions

- Prefer fixing the existing `triage --mark-ready` flow over adding a command.
- Preserve current refusal behavior for behind-base, active-lock, or unsafe
  worktrees.
- Error output should distinguish push/auth failures from missing-upstream
  setup.

## Documentation updates

- Update `v1/docs/operator-runbook.md` complete-but-dirty recovery once no manual
  `git push --set-upstream` stopgap is needed.
