# Prompt Governance

This document defines prompt identity and validation for Jarvis-managed prompts.

## First Registry Rollout (Metadata-First)

The first rollout includes shared global guidance fragments plus prompt
artifacts that shape agent behavior in patch mode and plan draft/review:

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
  plan-only deferral fragment layered into plan draft/review prompts to
  avoid inventing precision before a first caller exists
- `plan.decisions-ledger` (`prompts/plan/decisions-ledger.md`) — shared
  plan-only structure fragment layered into plan draft/review prompts to
  require atomic decision/constraint/assumption ledger entries over narrative prose
- `shared.pr-description` (`prompts/shared/pr-description.md`) — shared
  PR-description fragment used by patch and plan PR-body generation steps to
  request model-authored Description and Decisions list

- `patch.prompt.body` (`prompts/patch/instructions.md`)
- `patch.prompt.pr-description` (`prompts/patch/pr-description.md`)
- `patch.rules` (`prompts/patch/rules.md`)
- `patch.prompt.shrink` (`prompts/patch/shrink.md`) — post-completion simplification gate; layered with `global.terse` only (not `patch.rules`)
- `plan.prompt.draft` (`prompts/plan/draft.md`)
- `plan.prompt.pr-description` (`prompts/plan/pr-description.md`)
- `plan.prompt.review` (`prompts/plan/review.md`)
- `plan.prompt.review-actuator` (`prompts/plan/review-actuator.md`)
- `intent.prompt.split` (`prompts/intent/split.md`) — intent-owned seed splitting prompt
- `intent.prompt.review` (`prompts/intent/review.md`) — intent-owned critic prompt for reviewing staged ready-intents
- `intent.prompt.review-actuator` (`prompts/intent/review-actuator.md`) — intent-owned actuator prompt for applying review verdicts

Deferred in this rollout:

- Human-facing chooser/confirmation text (for example
  `v1/src/disambiguation-prompt.ts`)

## Required Metadata

Each registered prompt artifact must start with leading frontmatter and include
all required fields:

- `id` (stable runtime lookup key)
- `behavior` (real grouping key: `global`, `patch`, `plan`, or another scoped class)
- `kind` (artifact type: `step` or `fragment`)
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
- Rendering is metadata-driven by step `id`; callers do not pass explicit fragment lists.
- Step definitions may explicitly add or remove named fragments.
- Remove directives are strict runtime behavior (removal is honored, not
  best-effort).
- Patch layering is `global.documentation -> global.naming -> global.terse -> patch.prompt.body`.
- Plan draft/review layering is `global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer -> plan.prompt.*`.
- `patch.rules` remains step-owned injected content, not an always-layered patch fragment.
- `patch.prompt.shrink` is a post-completion step prompt (not layered into `patch.prompt.body`). It layers `global.terse` only — not `global.documentation`, `global.naming`, or `patch.rules`. Prevention surfaces (`global.terse`, `patch.rules`) run during implementation; `patch.prompt.shrink` is the post-completion gate that hunts named bloat patterns after the spec is complete.
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
- plan draft/review prompts (draft `@r7`, review `@r6`; review
  includes multiple pass contexts)
- plan review actuator prompt (`plan.prompt.review-actuator`, currently `@r3`)
- codex transport wrapper variant (`codex.exec.stdin+marker`)

Coverage remains assembled-output focused: tests assert final rendered prompt
text and wrapper outputs rather than fragment-only snapshots.
