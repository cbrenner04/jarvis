---
name: triage-merge-plan-prs
---

# Gated `triage --merge` for plan-generated spec PRs

## Problem

`jarvis1 triage <plan-pr|plan-worktree> --merge` fails before merge on plan-generated spec PRs because finalize uses implementation acceptance-criteria completion. Operators hand-merge plan PRs despite runbook guidance to prefer `triage --merge`.

## Desired behavior

`jarvis1 triage <plan-pr|plan-worktree|plan-spec> --merge` admin-squash-merges a plan-generated spec PR through the existing gated path (local ready gate, promote draft PR when needed, poll CI green) when the PR is open and safe to land. Implementation still starts afterward via `jarvis1 run <spec>/index.md`.

Refusal messages name whether the target is a plan PR, an implementation PR, an unknown worktree, or a non-mergeable state.

## Decisions

- Extend `triage --merge`, not a new command — rules out `jarvis1 merge-plan` or similar.
- Plan-branch merge eligibility skips implementation acceptance-criteria completion — rules out requiring checked subspec AC before landing a spec-only PR.
- Patch-branch merge keeps today's acceptance-criteria completion gate — rules out weakening implementation PR safety.
- Reuse the existing gated merge sequence (ready gate → optional `gh pr ready` → CI poll → admin squash) — rules out a plan-only hand-merge shortcut.
- Merge only lands the spec PR; no `jarvis1 run` side effects — rules out auto-starting implementation.
- Deferred to first consumer: additional plan-only pre-merge guards beyond open PR + gate + CI — pin when the first failing plan PR surfaces a gap.

## Documentation updates

- `v1/docs/operator-runbook.md` — Merging: name plan PR / plan worktree / plan spec path as supported `triage --merge` targets; drop any caveat that plan PRs must merge outside Jarvis.
- `v2/docs/v1-behaviors.md` — `triage --merge` plan-branch eligibility and refusal taxonomy.

## Prerequisites

- `jarvis1 triage <target> --merge` runs the gated admin-squash merge path for implementation PRs after target resolution
- `jarvis1 triage --mark-ready` and resolved `triage --merge` targets derive spec paths from branch names when `.active-spec-path` is absent
