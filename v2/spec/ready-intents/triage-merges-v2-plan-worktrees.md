---
name: triage-merges-v2-plan-worktrees
---

# Gated merge finds v2 plan specs

## Behavior

`jarvis1 triage <target> --merge` resolves a `plan/*` worktree in the registered project's Jarvis-owned v2 home, finds the spec from that worktree when it is absent from the primary checkout, runs the existing local-ready and CI-green gates, and merges.

Unchecked plan-spec acceptance criteria remain eligible for merge.

## Decisions

- Reuse the existing two-home merge-target resolution for plan-spec lookup; rules out a v2-only resolver that can drift.
- Preserve plan-PR completeness semantics; rules out tightening acceptance checks while fixing lookup.

## Documentation updates

- `v1/docs/operator-runbook.md` Merging: record v2-home plan-spec lookup and remove the plan hand-merge workaround.
- `v2/docs/operator-runbook.md`: remove plan PRs from the v2 merge gotcha; delete the gotcha if no unsupported shape remains.
- `v2/docs/v1-behaviors.md`: record v2-home plan-spec resolution.

## Prerequisites

- `triage --merge` resolves targets across the repository and registered-project worktree homes.
- `triage --merge` permits plan PRs with unchecked subspec acceptance criteria.
