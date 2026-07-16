---
name: workflow-prs-use-spec-titles
---

# Workflow PRs use spec-derived titles

Plan and implement PRs currently reach publication without a title and become
`jarvis: complete run`, erasing the change subject from squash-merge history.

Use one publication title resolver for every workflow. Plan and implement use the
spec index's first H1; an H1-less index uses its directory basename, and a non-index
spec uses its file basename. Intent retains `intent: <name>`. Publication rejects an
unresolvable title by name instead of emitting the generic literal.

## Decisions

- Resolve titles at the shared publication seam; rules out per-workflow opt-in fields that can be omitted.
- Retain `intent: <name>` for intent PRs; rules out replacing the already-meaningful title with the staged spec H1.
- Derive missing-heading titles from the spec path and reject unreadable identity; rules out `jarvis: complete run` as a fallback.

## Documentation updates

- `v2/docs/write-behavior.md` — publication title resolution and failure contract.
- `v2/docs/v1-behaviors.md` — v2 port of v1 `getIndexTitle` semantics.
- `v2/docs/first-workflow-walkthrough.md` — draft PR title example and fallback.

## Prerequisites
