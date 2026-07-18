---
name: implement-rerun-resets-stale-workspace
---

# An incomplete implement re-run starts from base

Re-running `jarvis run workflow implement` for an incomplete spec never reuses prior ticked implementation work. Before agent invocation it either retires the stale worktree, local and remote branch, and matching draft PR and recreates the branch from the requested base, or exits non-zero with the state that prevented a safe reset. The next publication uses a fresh matching draft PR.

## Decisions

- Reset only when the spec file still has unticked non-human acceptance criteria; rules out erasing a complete implementation because a run row is stale.
- Refuse a live workspace, ready PR, or ambiguous matching PR before mutation; rules out overwriting concurrent or operator-reviewed work.
- Close the stale draft PR before deleting its branch so later publication creates a usable PR; rules out stranding publication against a closed-branch PR.

## Out of scope

- Automatically implementing an already-complete spec.
- Resetting git-disabled runs.
- Repairing historical daemon rows.

## Prerequisites

- A named stale v2 workspace can be retired with live-owner and PR-safety guards while preserving its source spec.

## Documentation updates

- `v2/docs/operator-runbook.md` — clean re-run behavior and refusal recovery.
- `v2/docs/v1-behaviors.md` — record v2's reset-on-incomplete-re-run behavior.
