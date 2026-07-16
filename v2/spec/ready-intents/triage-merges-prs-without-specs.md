---
name: triage-merges-prs-without-specs
---

# Gated merge accepts PRs without specs

## Behavior

`jarvis1 triage <target> --merge` accepts a resolved PR whose branch has no spec, runs the same local-ready and CI-green gates as a spec-backed PR, and merges only when both pass.

Spec-backed merge completeness checks and active-spec handling remain unchanged.

## Decisions

- Treat missing spec as a valid merge shape after target resolution; rules out refusing seed, report, intent, and docs PRs.
- Keep one gated merge command for spec-backed and spec-less PRs; rules out a weaker parallel merge command.

## Documentation updates

- `v1/docs/operator-runbook.md` Merging: make `triage --merge` the gated path for seed, report, intent, and docs PRs and remove their manual-fallback carve-out.
- `v2/docs/operator-runbook.md`: remove spec-less PRs from the v2 merge gotcha; delete the gotcha if no unsupported shape remains.
- `v2/docs/v1-behaviors.md`: record spec-less gated merge behavior.

## Prerequisites

- `triage --merge` resolves a PR target to a local worktree before applying spec completeness and merge gates.
- `triage --merge` requires the local ready gate and CI green before admin-squash-merge.
