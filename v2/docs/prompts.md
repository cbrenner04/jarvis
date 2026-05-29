# Prompt governance for jarvis1 and v2

> **Status: original design intent — superseded by [`v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md) for the as-shipped contract.**
> The registry and renderer shipped in #121/#122; the v1 doc is canonical
> wherever it and this doc disagree. Known drift from what shipped: frontmatter
> fields (`behavior: agent-facing` / `kind: template`, list-form `placeholders`),
> `<NAME>` delimiter syntax instead of `{{name}}`, and snapshot keying/paths.
> Kept for historical design context.

This document defines how prompt artifacts are owned, reviewed, versioned, and migrated across `jarvis1` (v1) and v2.

It is the prompt-governance companion to `v2/docs/v1-behaviors.md`, not a second behavior catalog. `v1-behaviors.md` records externally observable behavior. This file defines prompt surfaces, ownership boundaries, and migration mechanics for those surfaces.

## Scope and source authority

Current v1 source is the authority for today's prompt surfaces and ownership decisions. The inventory below is organized by prompt purpose and lifecycle, then anchored to specific source files so relocation work cannot miss concrete surfaces.

## Prompt-surface taxonomy

All current and future prompt surfaces are classified in one of these buckets.

1. Agent-bound prompt bodies/fragments
These are instruction bodies and reusable fragments sent to an agent as task content.

2. Agent transport wrappers and correlation markers
These are adapter-specific wrappers or markers added around prompt payloads for transport, tracing, or usage correlation.

3. Human-facing chooser/confirmation text
These are operator prompts and chooser strings rendered for interactive or non-interactive human flows.

4. Generated handoff/next-step text
These are runtime-generated status blocks, continuation commands, and handoff instructions shown after or between phases.

Human-facing chooser and confirmation strings remain part of the broader prompt-surface inventory even when first-pass extraction keeps them in runtime code.

## Prompt artifact boundary vs runtime boundary

Prompt artifacts are reviewable source text that expresses stable instructions. Runtime code is responsible for control flow, validation, and formatting mechanics.

Prompt artifacts in the first extraction pass:

- `v1/src/modes/patch/rules.md`
- Plan prompt templates under `v1/src/modes/plan/prompts/*.md`
- Stable instruction lines currently assembled in `v1/src/modes/patch/prompt.ts`

Runtime-owned code that stays in TypeScript for now:

- Placeholder substitution and template validation (`v1/src/modes/plan/template-renderer.ts`), including the non-recursive substitution contract
- Boundary enforcement and boundary-blocker behavior (`v1/src/commands/plan.ts` + boundary helpers)
- Spec parsing / checklist routing / index checks (`v1/src/modes/patch/spec.ts`, `completion.ts`, and patch preflight call sites)
- Quota fallback and agent-order failover orchestration (`v1/src/modes/patch/run.ts`, `v1/src/commands/plan.ts`, and agent quota helpers)
- Git/worktree/write-boundary checks and commit/PR control logic
- Runtime formatting for generated sibling bullets, chooser lists, and handoff command lines

As shipped, the prompt registry/renderer surface is root-shared in
`shared/prompts/api.ts` and consumed by both engines (`jarvis1` through
`v1/src/prompts/*` re-exports, and v2 directly).

For mixed builders, only stable instruction text relocates in pass one; interpolation, conditional line construction, and control semantics stay in code.

## Current v1 prompt-surface inventory and first-pass ownership

| Bucket | Current surface | Current source location | First-pass ownership call | Relocation unit | Migration timing / notes |
| --- | --- | --- | --- | --- | --- |
| Agent-bound prompt bodies/fragments | Patch prompt body scaffold (`Inspect...`, `Read the spec...`, `Follow these Jarvis rules...`, `Pick the single most important...`) | `v1/src/modes/patch/prompt.ts` | Move to shared prompt source now | Stable instruction text fragments only | First extraction pass is relocation-only. Keep conditional sibling-directory bullet rendering in TS. |
| Agent-bound prompt bodies/fragments | Injected patch rules body | `v1/src/modes/patch/rules.md` | Move to shared prompt source now | Entire markdown file verbatim | Direct artifact move in first extraction pass. |
| Agent-bound prompt bodies/fragments | Plan refine prompt | `v1/src/modes/plan/prompts/refine.md` | Move to shared prompt source now | Entire file verbatim | Keep runtime template rendering in code; move text only. |
| Agent-bound prompt bodies/fragments | Plan name-only prompt | `v1/src/modes/plan/prompts/name-only.md` | Move to shared prompt source now | Entire file verbatim | Same rendering contract as other plan prompts. |
| Agent-bound prompt bodies/fragments | Plan draft prompt | `v1/src/modes/plan/prompts/draft.md` | Move to shared prompt source now | Entire file verbatim | Sentinel-delimited data sections remain literal prompt text. |
| Agent-bound prompt bodies/fragments | Plan review prompt | `v1/src/modes/plan/prompts/review.md` | Move to shared prompt source now | Entire file verbatim | Keep current file rewrite constraints in prompt artifact. |
| Agent-bound prompt bodies/fragments | Write execute prompt | `prompts/write/execute.md` | Move to shared prompt source now | Entire file verbatim | Stable ID `write.execute`; first v2 write-step prompt surface. |
| Agent-bound prompt bodies/fragments | Plan inline-draft prompt template | `v1/src/modes/plan/prompts/inline-draft.md` (loaded by `v1/src/modes/plan/inline-draft.ts`) | Move to shared prompt source now | Entire file verbatim | Keep loader invocation and template slot filling in runtime code. |
| Agent transport wrappers and correlation markers | Codex invocation marker wrapper appended to outbound prompt payload | `v1/src/agents/codex.ts` (`<!-- jarvis-codex-invocation: <uuid> -->`) | Minimized adapter-local prompt surface | Marker string constant + append behavior | Adapter-transport concern; keep local to Codex adapter with snapshot coverage. |
| Human-facing chooser/confirmation text | TTY-only non-index confirmation text (`[s] switch`, `[e] exit`, `Choice [e]`) | `v1/src/modes/patch/run.ts` | Keep in runtime code for now | Prompt line array + response handling as one unit | Operator control-flow chooser, not shared agent prompt artifact in pass one. |
| Human-facing chooser/confirmation text | Project disambiguation chooser text (interactive + non-TTY candidate output) | `v1/src/disambiguation-prompt.ts` | Keep in runtime code for now | `promptForProject` user-facing strings + list rendering | Human routing UX; still inventory-tracked for later unification review. |
| Generated handoff/next-step text | Printed plan next-step / handoff output (draft PR review, resume command, run command guidance) | `v1/src/commands/plan.ts` | Keep in runtime code for now | `buildPlanCompletionMessage` output block | Runtime-generated from repo/spec/PR state; not moved in relocation-only pass. |

## Mixed-source relocation notes

### `v1/src/modes/patch/prompt.ts`

Relocate now:

- Stable instruction lines that define task intent and loop posture
- Stable wrapper phrase introducing patch rules

Keep in runtime TS for now:

- Sibling-directory conditional branch
- Runtime-generated bullet list of sibling paths
- Join and ordering logic that depends on runtime inputs

This split allows a no-wording-change first extraction while avoiding premature fragment-composition changes.

## Conservative first-pass decisions locked for migration

The first extraction pass is a no-wording-change relocation of prompt-owned text.

Move now into shared prompt source:

- `v1/src/modes/patch/rules.md`
- `v1/src/modes/plan/prompts/refine.md`
- `v1/src/modes/plan/prompts/name-only.md`
- `v1/src/modes/plan/prompts/draft.md`
- `v1/src/modes/plan/prompts/review.md`
- `v1/src/modes/plan/prompts/inline-draft.md`
- Stable instruction text currently assembled in `v1/src/modes/patch/prompt.ts`

Keep in runtime code for now:

- Project disambiguation chooser strings (`v1/src/disambiguation-prompt.ts`)
- TTY-only non-index patch confirmation text (`v1/src/modes/patch/run.ts`)
- Printed plan next-step and handoff text (`v1/src/commands/plan.ts`)

Classify as minimized adapter-local prompt surface:

- Codex invocation marker wrapper in `v1/src/agents/codex.ts`

## Shared prompt layout and metadata contract

Shared prompt source lives in top-level `prompts/` and is organized by v2
behavior vocabulary so both `jarvis1` and v2 bind to the same structure:

```text
prompts/
  fragments/
    global/
    write/
    review-and-update/
    human/
  steps/
    write/
    review-and-update/
    human/
  adapters/
    codex/
    claude/
    cursor/
```

Layout semantics:

- `fragments/*`: reusable prompt `fragment` artifacts.
- `steps/*`: renderable `step` artifacts that define behavior-step identity and
  step task body.
- `adapters/*`: minimized adapter-local `step` wrapper artifacts for unavoidable
  CLI-specific framing.

Runtime lookup binds to prompt metadata `id` only. File path is organizational
detail and is not a runtime key.

Each renderable source artifact uses leading frontmatter metadata with required
fields:

- `id`: stable prompt ID used as runtime key.
- `behavior`: one of `write`, `review-and-update`, `human`.
- `kind`: `step` or `fragment`.
- `revision`: monotonic revision signal for that ID.

`step` artifacts additionally declare:

- `fragments`: ordered default layering references by fragment ID.
- `placeholders`: declared placeholder schema (name + type + required flag).
- `delimiters`: required delimiter policy for injected user data sections.
- `fragment_overrides`: explicit `add` and `remove` fragment ID lists when the
  step differs from behavior defaults.

Concrete metadata example (binding by ID, not path):

```md
---
id: write.patch.execute
behavior: write
kind: step
revision: 3
fragments:
  - global.terse
  - write.boundary-rules
placeholders:
  spec_path: { type: path, required: true }
  rules_block: { type: markdown, required: true }
delimiters:
  user_data: markdown_fence
fragment_overrides:
  add: [write.patch.sibling-guidance]
  remove: []
---
Inspect the target repo for guidance, conventions, and relevant docs.
Read the spec at {{spec_path}}.
Follow these Jarvis rules:
{{rules_block}}
Pick the single most important unchecked task and complete it.
```

Validation failures are hard errors:

- Duplicate `id` across all prompt artifacts.
- Missing required metadata (`id`, `behavior`, `kind`, `revision`).
- Unknown prompt reference ID (for fragment references or override IDs).

## Rendering contract and layering rules

First implementation rendering contract is narrow and explicit.

Prompt source owns:

- Ordered fragment membership declarations.
- Step task text.
- Delimiter declarations for injected user data zones.
- Placeholder declarations (name/type/required).
- Explicit fragment override intent (`add`/`remove`).

Renderer/runtime code owns:

- Placeholder substitution and type/required validation.
- Enforcing non-recursive substitution (one substitution pass only).
- Layer assembly and delimiter insertion mechanics.
- Adapter wrapper selection and transport composition.
- Hard-fail validation handling for duplicate/missing/unknown IDs.

Default layering order:

1. Global fragments.
2. Behavior fragments.
3. Step body.

Override semantics:

- `add`: append listed fragment IDs after behavior fragments and before step
  body, preserving listed order.
- `remove`: remove matching fragment IDs from inherited global/behavior lists
  before final assembly.
- Overrides are explicit per step; no implicit path-based inheritance.

Placeholder and delimiter rules:

- Every placeholder used in `step` text must be declared in metadata.
- Missing required placeholder values are hard validation failures.
- Type mismatch for declared placeholders is a hard validation failure.
- Injected user content is always treated as opaque data, never as template
  source.
- Renderer preserves delimiter guards around injected user content and never
  allows injected content to escape delimiter boundaries.
- Delimiter and substitution invariants are enforced in code, not through
  prompt-template logic.

Adapter-wrapper boundary:

- Shared artifact owns step identity (`id`) and core instruction text.
- Adapter-specific wrappers are allowed only when unavoidable for CLI transport.
- Adapter wrappers remain thin, separately classified under `prompts/adapters`,
  minimized in scope, and covered by rendered snapshots.

Human-facing chooser/confirmation strings:

- Interactive chooser/confirmation strings remain cataloged prompt surfaces
  (from subspec 00) but are excluded from the first shared prompt-registry and
  snapshot contract in this slice.
- First contract scope is shared agent-bound artifacts (`step` + `fragment`) and
  minimized adapter-local wrappers only.

## Review, snapshots, and revision rules

Revision rule (per prompt `id`):

- Bump `revision` when prompt wording changes.
- Bump `revision` when a step's effective fragment set changes (including
  override changes that alter rendered output).
- Do not bump `revision` for file moves/renames only.
- Do not bump `revision` for metadata comment-only edits that do not affect
  rendering semantics.

Rendered snapshots are keyed by prompt ID plus revision, never by source path.
Snapshot location:

```text
prompts/snapshots/rendered/<id>/r<revision>/<variant>.md
```

`<variant>` distinguishes shared step render and adapter-local wrapper render:

- `step.md`: shared rendered step output (after fragment layering +
  substitution).
- `wrapper.<adapter>.md`: adapter-local wrapped output for that same step ID.

Concrete snapshot path examples:

- `prompts/snapshots/rendered/write.patch.execute/r3/step.md`
- `prompts/snapshots/rendered/write.patch.execute/r3/wrapper.codex.md`

Initial rendered-snapshot testing standard (deterministic correctness):

- Verifies default layering order (`global -> behavior -> step`).
- Verifies explicit `add`/`remove` override behavior.
- Verifies missing required placeholders fail validation.
- Verifies non-recursive substitution (substituted values are not re-expanded).
- Verifies delimiter preservation around injected user content.
- Verifies adapter-wrapper selection for unavoidable adapter-local layers.
- Verifies ID-based lookup/assembly and hard failures for duplicate, missing, and
  unknown IDs.

Test placement rule for v2 source:

- Prompt renderer/registry tests live co-located with v2 renderer/registry
  source (`v2/src/**`) per v2 test co-location guidance, not in a parallel
  `v2/test/` tree.

## Migration sequence and follow-on intents

Migration is staged so prompt-wording moves stay mechanically auditable and do
not get conflated with renderer behavior changes.

### Stage 1 (immediate): relocation-only extraction

Intent file: `v2/spec/wip-intents/2026-05-23-prompts-relocation-extraction.txt`

Scope:

- Move prompt-owned v1 artifacts into shared prompt source with no wording
  changes.
- Keep current runtime composition behavior in place.
- Keep adapter-local wrappers and human chooser/confirmation strings in runtime
  code for this stage.

Guardrails:

- No wording changes.
- No new fragment-composition semantics.
- No renderer contract expansion beyond what is needed to read relocated
  artifacts.

Why strict relocation first:

- It isolates "where text lives" from "how text is rendered."
- Prompt diffs remain one-to-one against current source text, making review
  and blame mechanically clear.
- Failures in later renderer/snapshot work cannot be mistaken for extraction
  mistakes.

### Stage 2 (immediate): registry + renderer + revision/snapshot support

Intent file:
`v2/spec/wip-intents/2026-05-23-prompts-registry-renderer-revisions-snapshots.txt`

Scope:

- Add prompt registry and ID lookup.
- Enforce duplicate/missing/unknown ID validations as hard failures.
- Add revision-aware rendered snapshot rules and deterministic tests.
- Lock the first implementation rendering contract (ordering, overrides,
  placeholders, delimiter handling, non-recursive substitution, wrapper
  selection).

This stage is intentionally separate from relocation so rendering and
validation behavior changes are independently reviewable.

### Stage 3 (deferred follow-on): layered composition adoption

No immediate third intent is created in this tree. Layered-composition
adoption is explicitly deferred until Stages 1 and 2 land.

Deferred scope:

- Promote mixed inline prompt assembly (for example, the patch prompt text
  currently assembled in `v1/src/modes/patch/prompt.ts`) to richer fragment
  composition only after baseline relocation and registry/snapshot guarantees
  are stable.

Deferral rationale:

- Composition changes alter effective rendered text and can obscure relocation
  audit trails.
- Deferring composition keeps immediate work atomic and avoids combining three
  independent risk classes (move, render, compose) in one implementation pass.

## Shared-evolving v1 decision (migration lock)

`jarvis1` and v2 read one shared, evolving prompt source of truth. Prompt
wording changes are shared behavior changes and must follow the same review and
snapshot expectations because they can affect both engines.

## Unresolved risks and tradeoffs

1. Adapter-local wrapper scope
How much wrapper text should remain adapter-local versus moved into shared
prompt artifacts is still a judgment call. Current posture keeps wrappers thin
and transport-focused, but this boundary may need revisiting as adapters evolve.

2. Timing of layered composition adoption
After relocation lands, waiting too long to adopt explicit layered composition
could leave mixed inline assembly in runtime code longer than desired. Moving
too early risks coupling composition refactors to extraction validation and
slowing review.

3. Snapshot-first versus broader eval coverage
Deterministic rendered snapshots are the immediate safety bar. Broader eval
coverage (quality/outcome drift analysis) remains an open later decision and is
not part of this first migration sequence.
