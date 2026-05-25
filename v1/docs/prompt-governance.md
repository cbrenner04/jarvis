# Prompt Governance

This document defines prompt identity and validation for Jarvis-managed
agent-facing prompts.

## First Registry Rollout (Metadata-First)

The first rollout includes shared global guidance fragments plus prompt
artifacts that
shape agent behavior in patch mode and plan draft/review/refine:

- `global.terse` (`prompts/global/terse.md`) — shared terse fragment layered
  into agent-facing prompts
- `global.documentation` (`prompts/global/documentation.md`) — shared
  documentation-first fragment layered into agent-facing prompts; owns
  documentation-read/update ordering and routes placement to
  `v2/docs/documentation-standard.md`
- `global.naming` (`prompts/global/naming.md`) — shared naming fragment layered
  into patch-mode prompts; forbids planning labels in code identifiers,
  filenames, types, and public API
- `plan.defer-to-consumer` (`prompts/plan/defer-to-consumer.md`) — shared
  plan-only deferral fragment layered into plan draft/review/refine prompts to
  avoid inventing precision before a first caller exists
- `plan.decisions-ledger` (`prompts/plan/decisions-ledger.md`) — shared
  plan-only structure fragment layered into plan draft/review/refine prompts to
  require atomic decision/constraint/assumption ledger entries over narrative prose

- `patch.prompt.body` (`prompts/patch/instructions.md`)
- `patch.rules` (`prompts/patch/rules.md`)
- `plan.prompt.draft` (`prompts/plan/draft.md`)
- `plan.prompt.review` (`prompts/plan/review.md`)
- `plan.prompt.refine` (`prompts/plan/refine.md`)

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

Validation and rendering failures are intentionally split:

- Registry-load failures (metadata/relationship validation) are asserted in
  `v1/test/prompts/registry.test.ts`.
- Render-time failures (unknown runtime ID lookup, placeholder/type checks, and
  delimiter policy) are asserted in `v1/test/prompts/renderer.test.ts`.

## Renderer Contract

Shared rendering follows this contract:

- Assembly order is deterministic: `global -> behavior -> step`.
- Step definitions may explicitly add or remove named fragments.
- Remove directives are strict runtime behavior (removal is honored, not
  best-effort).
- Global guidance is layered via shared fragments (`global.documentation`, then `global.naming`, then `global.terse`) rather than duplicated across step prompts or `patch.rules`.
- Patch global guidance is layered via shared fragments
  (`global.documentation`, then `global.naming`, then `global.terse`) rather
  than duplicated across step prompts or `patch.rules`.
- Plan global guidance layers `global.documentation`, `global.terse`, then
  `plan.decisions-ledger`, then `plan.defer-to-consumer`.
- `global.documentation` requires docs-first execution order: read relevant
  durable docs/specs before code edits, and update docs/specs in the same
  subspec when behavior/architecture/workflow/prompt/operator-facing semantics
  change, unless the active subspec explicitly says no docs are required for a
  purely internal change.
- `global.terse` is scoped to communication artifacts (specs, PRs, commits,
  intents) and does not authorize under-documenting code.

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

## Snapshot Keying

Rendered prompt snapshots for this rollout use revision-aware keys:

- Shared prompt body snapshots: `<id>@r<revision>...shared.txt`
- Wrapper snapshots: `<id>@r<revision>.wrapper.<variant>.txt`

Wrapper snapshots are adapter-local post-render artifacts; they must be stored
and reviewed separately from shared prompt body snapshots.

Current snapshot coverage lives under `v1/test/fixtures/prompts/rendered/` and
is asserted by `v1/test/prompts/rendered-snapshots.test.ts`, including:

- patch prompt body (`patch.prompt.body`, currently `@r3`)
- plan draft/review/refine prompts (draft/refine `@r4`, review `@r5`; review
  includes multiple pass contexts)
- codex transport wrapper variant (`codex.exec.stdin+marker`)

Coverage remains assembled-output focused: tests assert final rendered prompt
text and wrapper outputs rather than fragment-only snapshots.
