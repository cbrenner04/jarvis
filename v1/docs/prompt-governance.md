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
- `placeholders` (declared placeholder contract, `NAME:string` or
  `NAME:string!` for required)

## Validation Boundary

Registry validation runs eagerly during registry load, before any prompt render
or agent invocation logic:

- Missing required metadata is a hard load error.
- Duplicate IDs are a hard load error.
- Unknown `fragmentOf` IDs are hard load errors.
- Unknown `overrides` IDs are hard load errors.

Runtime prompt lookup is by stable `id` only. File paths are implementation
detail and are not part of the runtime lookup contract.

## Renderer Contract

Shared rendering follows this contract:

- Assembly order is deterministic: `global -> behavior -> step`.
- Step definitions may explicitly add or remove named fragments.
- Remove directives are strict runtime behavior (removal is honored, not
  best-effort).

Template substitution is non-recursive:

- Placeholder tokens in source templates are replaced once.
- Placeholder-looking text inside injected values is preserved as literal data.

## Runtime Ownership Boundary

Prompt source controls:

- Prompt wording and delimiter placement.
- Placeholder declarations (`placeholders`) and requiredness.
- Explicit fragment relationships and step-level add/remove wiring.

TypeScript runtime code controls:

- Delimiter policy enforcement for user-supplied values (rejecting values that
  contain reserved sentinel delimiters).
- Placeholder type validation and missing-required checks at render time.
- Conditional/structural formatting of dynamic values before rendering (for
  example patch sibling-directory bullets).
- Adapter transport wrappers after render (for example Codex invocation marker
  append); wrappers are not distinct shared prompt IDs.
