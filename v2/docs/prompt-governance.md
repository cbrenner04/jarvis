# Prompt Governance

This document defines prompt identity and validation for Jarvis-managed prompts.

## First Registry Rollout (Metadata-First)

The first rollout includes shared global guidance fragments plus prompt artifacts that shape agent behavior in patch mode and plan draft/review:

- `global.terse` (`prompts/global/terse.md`) — shared terse fragment layered into agent-facing prompts; applies to code and comments as much as specs and PRs, and names the padding to cut
- `global.documentation` (`prompts/global/documentation.md`) — shared
  documentation-first fragment layered into agent-facing prompts; owns
  documentation-read/update ordering and routes placement to
  `v2/docs/documentation-standard.md`
- `global.naming` (`prompts/global/naming.md`) — one-sentence fragment forbidding planning labels in identifiers, filenames, types, and public API; removed from intent and plan steps
- `global.no-hard-wrap` (`prompts/global/no-hard-wrap.md`) — one-sentence fragment layered after `global.terse`: one physical line per paragraph and list item, never a split checkbox
- `plan.defer-to-consumer` (`prompts/plan/defer-to-consumer.md`) — shared
  plan-only deferral fragment layered into plan draft/review prompts to
  avoid inventing precision before a first caller exists
- `plan.decisions-ledger` (`prompts/plan/decisions-ledger.md`) — shared
  plan-only structure fragment layered into plan draft/review prompts to
  require atomic decision/constraint/assumption ledger entries over narrative prose

- `implement.prompt.body` (`prompts/implement/instructions.md`) — the implement write-step body; carries `<PATCH_RULES>` as the placeholder key for `implement.rules`
- `implement.rules` (`prompts/implement/rules.md`) — target-repo-neutral implement rules injected through `PATCH_RULES`; jarvis-specific test recovery rules live in this repo's `AGENTS.md`
- `implement.prompt.shrink` (`prompts/implement/shrink.md`) — post-completion simplification gate; layered with `global.terse -> global.no-hard-wrap` only (not `implement.rules`)
- `implement.prompt.review.critic` / `.adversary` / `.advocate` / `.adjudicator` (`prompts/implement/review-*.md`) — implement review critic and debate roles; `BRANCH_DIFF` is always the merge-base unified diff (stat, changed paths, then the diff itself)
- `plan.prompt.draft` (`prompts/plan/draft.md`)
- `plan.prompt.review.critic` (`prompts/plan/review-critic.md`) — editorial critic for light plan-review workflow; read-only advisory role reviewing spec clarity and completeness
- `plan.prompt.review-actuator` (`prompts/plan/review-actuator.md`)
- `intent.prompt.split` (`prompts/intent/split.md`) — intent-owned seed splitting prompt
- `intent.prompt.review` (`prompts/intent/review.md`) — intent-owned critic prompt for reviewing staged ready-intents
- `intent.prompt.review-actuator` (`prompts/intent/review-actuator.md`) — intent-owned actuator prompt for applying review verdicts

Deferred in this rollout:

- Human-facing chooser/confirmation text (CLI prompts and usage strings)

## Required Metadata

Each registered prompt artifact must start with leading frontmatter and include all required fields:

- `id` (stable runtime lookup key)
- `behavior` (real grouping key: `global`, `patch`, `plan`, or another scoped class)
- `kind` (artifact type: `step` or `fragment`)
- `fragmentPolicy` (steps only: `global`, `behavior`, or `none` — which fragments assemble ahead of the body; see [`prompts.md`](./prompts.md#fragment-frontmatter-contract))
- `revision` (change-visible revision marker)

Optional relationship fields used during validation:

- `fragmentOf` (IDs this artifact declares itself as a fragment of)
- `overrides` (IDs this artifact explicitly overrides)
- `placeholders` (declared placeholder contract, `NAME:string` or
  `NAME:string!` for required)

## Validation Boundary

Registry validation runs eagerly during registry load, before any prompt render or agent invocation logic:

- Missing required metadata is a hard load error.
- Duplicate IDs are a hard load error.
- Unknown `fragmentOf` IDs are hard load errors.
- Unknown `overrides` IDs are hard load errors.

Runtime prompt lookup is by stable `id` only. File paths are implementation detail and are not part of the runtime lookup contract.

Validation and rendering failures are intentionally split:

- Registry-load failures (metadata/relationship validation) are asserted in
  `shared/prompts/registry.test.ts`.
- Render-time failures (unknown runtime ID lookup, placeholder/type checks, and
  delimiter policy) are asserted in `shared/prompts/render.test.ts`.

## Renderer Contract

Shared rendering follows this contract:

- Assembly order is deterministic: `global -> behavior -> step`, gated by the step's `fragmentPolicy` (`none` skips both fragment tiers, `global` skips the behavior tier).
- Rendering is metadata-driven by step `id` through the one entry point `renderPromptForStep` (`shared/prompts/assemble.ts`); callers do not pass explicit fragment lists or hand-roll a render path.
- Step definitions may explicitly add or remove named fragments.
- Remove directives are strict runtime behavior (removal is honored, not
  best-effort).
- Implement layering is `global.documentation -> global.naming -> global.terse -> global.no-hard-wrap -> implement.prompt.body` (`behavior: implement` has no behavior fragments; the implement review roles share the lane).
- Plan draft/review layering is `global.documentation -> global.terse -> global.no-hard-wrap -> plan.decisions-ledger -> plan.defer-to-consumer -> plan.prompt.*`.
- `implement.rules` remains step-owned injected content, not an always-layered implement fragment.
- `implement.prompt.shrink` is a post-completion step prompt (not layered into `implement.prompt.body`). It layers `global.terse -> global.no-hard-wrap` only — not `global.documentation`, `global.naming`, or `implement.rules`. Prevention surfaces (`global.terse`, `implement.rules`) run during implementation; `implement.prompt.shrink` is the post-completion gate that hunts named bloat patterns after the spec is complete.
- `global.documentation` requires docs-first execution order: read relevant
  durable docs/specs before code edits, and update docs/specs in the same
  subspec when behavior/architecture/workflow/prompt/operator-facing semantics
  change, unless the active subspec explicitly says no docs are required for a
  purely internal change.
- `global.terse` applies everywhere, code included; required docs are owned by `global.documentation`, so terseness never reads as license to skip them.

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

## Change Visibility

The `revision` field is the change-visible marker: every prompt edit bumps it, and the mutation verifier maps a changed registered prompt to its render-observer tests (`shared/prompts/render-observer-tests.ts`), which assert the assembled output of the live renderers. Post-render string surgery on rendered prompts is forbidden by `shared/prompts/no-prompt-surgery-guard.ts`.

Revision-keyed rendered snapshots (`<id>@r<revision>...shared.txt`, `<id>@r<revision>.wrapper.<variant>.txt`) were asserted by the frozen v1 test tree and are no longer a gate; the fixtures remain under `v1/test/fixtures/prompts/rendered/` as a historical record.
