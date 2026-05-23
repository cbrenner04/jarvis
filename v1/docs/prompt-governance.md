# Prompt Governance

This document defines prompt identity and validation for Jarvis-managed
agent-facing prompts.

## First Registry Rollout (Metadata-First)

The first rollout includes only prompt artifacts that shape agent behavior in
patch mode and plan draft/review/refine:

- `patch.prompt.body` (`v1/src/modes/patch/prompts/body.md`)
- `patch.rules` (`v1/src/modes/patch/rules.md`)
- `plan.prompt.draft` (`v1/src/modes/plan/prompts/draft.md`)
- `plan.prompt.review` (`v1/src/modes/plan/prompts/review.md`)
- `plan.prompt.refine` (`v1/src/modes/plan/prompts/refine.md`)

Deferred in this rollout:

- Human-facing chooser/confirmation text (for example
  `v1/src/disambiguation-prompt.ts`)
- Plan authoring helpers not yet migrated to the shared contract (currently
  `name-only.md` and `inline-draft.md`)

## Required Metadata

Each registered prompt artifact must start with leading frontmatter and include
all required fields:

- `id` (stable runtime lookup key)
- `behavior` (prompt behavior class)
- `kind` (artifact type, for example `template` or `rules`)
- `revision` (change-visible revision marker)

Optional relationship fields used during validation:

- `fragmentOf` (IDs this artifact declares itself as a fragment of)
- `overrides` (IDs this artifact explicitly overrides)

## Validation Boundary

Registry validation runs eagerly during registry load, before any prompt render
or agent invocation logic:

- Missing required metadata is a hard load error.
- Duplicate IDs are a hard load error.
- Unknown `fragmentOf` IDs are hard load errors.
- Unknown `overrides` IDs are hard load errors.

Runtime prompt lookup is by stable `id` only. File paths are implementation
detail and are not part of the runtime lookup contract.
