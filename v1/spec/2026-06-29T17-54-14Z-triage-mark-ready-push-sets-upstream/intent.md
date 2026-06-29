---
name: triage-mark-ready-push-sets-upstream
---

# Triage mark-ready sets upstream on first push

## Problem

`jarvis1 triage <worktree> --mark-ready` can create a finalize commit then fail to push when the implementation branch has no upstream — leaving the commit stranded locally and requiring manual `git push --set-upstream`.

## Desired behavior

When `triage --mark-ready` finalizes a complete worktree whose branch has no upstream, push with upstream setup automatically (`git push -u origin <branch>`), then continue the normal ready-promotion flow (open draft PR if absent, run gate once, mark ready on green).

## Decisions

- Fix the existing `triage --mark-ready` finalize push path — rules out a new standalone push-upstream command.
- Use `hasUpstream`-aware `firstPush` for finalize pushes (same pattern as patch iteration and plan commits) — rules out always calling plain `git push`.
- Preserve current refusal for behind-base, active-lock, and unsafe worktrees — rules out bypassing those guards for no-upstream branches.
- Auth/network push failures stay under `failed to push finalize commit` with git stderr — rules out a separate retry path that masks real push failures as upstream-setup issues.

## Documentation updates

- `v2/docs/v1-behaviors.md` — mark-ready finalize push sets upstream when absent.
- `v1/docs/operator-runbook.md` — complete-but-dirty recovery: no manual `git push --set-upstream` stopgap once mark-ready handles first push.

## Prerequisites
