# triage merge plan PRs

## Problem

The operator runbook says to prefer `jarvis1 triage ... --merge` for merges, but
plan-generated spec PRs are not mergeable through that path.

Observed on PR #802:

- `jarvis1 triage 802 --merge`
- `jarvis1 triage plan-register-codex-gpt-5-4-mini --merge`
- `jarvis1 triage v1/spec/2026-06-29T04-20-42Z-register-codex-gpt-5-4-mini/index.md --merge`

All failed before merge because triage could not find a runnable spec marker or
worktree for the plan branch/spec.

## Desired behavior

`jarvis1 triage <plan-pr|plan-worktree|plan-spec> --merge` should merge
plan-generated spec PRs when the plan PR is ready and safe, using the same
Jarvis-owned merge path operators use for implementation PRs.

## Decisions

- Do not add a new command unless `triage --merge` cannot reasonably cover this.
- Preserve the merge-first lifecycle: this only lands the spec PR; implementation
  still starts with a separate `jarvis1 run <spec>/index.md` after merge.
- Error messages should identify whether the target is a plan PR, implementation
  PR, unknown worktree, or non-mergeable state.

## Documentation updates

- Update `v1/docs/operator-runbook.md` merge guidance to name the supported
  `triage --merge` targets for plan/spec PRs.
- Remove any temporary caveat saying plan PRs must be merged outside Jarvis once
  this behavior ships.
