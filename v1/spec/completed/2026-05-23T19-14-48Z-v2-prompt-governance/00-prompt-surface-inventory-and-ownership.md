# 00 — Prompt surface inventory and ownership boundaries

## Problem

The prompt-governance design needs a grounded inventory of what v1 currently
sends to agents or humans, plus a conservative first-pass ownership decision
for each surface. Without that inventory, the later directory/layout and
migration decisions will drift into abstraction and miss concrete v1 prompt
surfaces that must either move into shared prompt source, remain runtime code,
or stay adapter-local.

This first slice should establish the design document, define the prompt-surface
taxonomy, and lock in the explicit ownership calls requested by the intent so
later subspecs can build on them without revisiting the basic classification.
It must also separate stable instruction text from runtime-generated formatting
inside mixed builders such as `v1/src/modes/patch/prompt.ts`, so later
relocation work can move only prompt-owned text in the first pass.

## Scope

Create `v2/spec/prompts.md` and fully author the sections that anchor the
governance design in current v1 reality:

- the document preamble and relationship to `v1-behaviors.md`
- the prompt-surface taxonomy
- the hard boundary between prompt artifacts and renderer/runtime logic
- the v1 inventory of current prompt surfaces by purpose and lifecycle
- first-pass ownership calls for each named v1 surface
- explicit notes where a current source mixes prompt-owned text with runtime
  formatting, so the inventory records which parts relocate verbatim and which
  parts stay in code for now

This slice should stop short of finalizing the rendering contract, snapshot
test matrix, versioning mechanics, or follow-on implementation intents; later
subspecs own those details. It should, however, leave behind a usable document
spine with later-section headings already in place so the next slices extend
the same file rather than reframe it.

## Primary sources

- `v2/spec/v1-behaviors.md`
- `v2/spec/v2-vision.md`
- `v2/spec/wip-v2-musings.md`
- `v1/src/modes/patch/prompt.ts`
- `v1/src/modes/patch/rules.md`
- `v1/src/modes/plan/inline-draft.ts`
- `v1/src/modes/plan/prompts/`
- `v1/src/disambiguation-prompt.ts`
- `v1/src/modes/patch/run.ts`
- `v1/src/commands/plan.ts`
- `v1/src/agents/codex.ts`
- `v1/src/modes/plan/template-renderer.ts`

## Task checklist

- [ ] Create `v2/spec/prompts.md` with a concise opening that positions it as
      the prompt-governance companion to `v2/spec/v1-behaviors.md`, not a
      second behavior catalog.
- [ ] Define a prompt-surface taxonomy with at least these four buckets:
      agent-bound prompt bodies/fragments, agent transport wrappers and
      correlation markers, human-facing chooser/confirmation text, and
      generated handoff/next-step text.
- [ ] Draw an explicit boundary between prompt artifacts and renderer/runtime
      logic, including the current v1 examples the intent calls out:
      prompt templates and `rules.md` stay prompt artifacts, while placeholder
      substitution, non-recursive rendering, boundary enforcement, spec
      parsing, quota fallback, and git/write-boundary checks remain code.
- [ ] Inventory the current v1 prompt surfaces named in the intent and refine
      turns as explicit entries, not a grouped shorthand. At minimum the doc
      must name:
      the patch prompt body assembled in `v1/src/modes/patch/prompt.ts`,
      injected patch `rules.md`,
      the plan refine prompt,
      the plan name-only prompt,
      the plan draft prompt,
      the plan review prompt,
      the inline-draft prompt loaded by `v1/src/modes/plan/inline-draft.ts`,
      TTY-only non-index confirmation text in patch run,
      project disambiguation chooser text,
      printed plan next-step/handoff text,
      and Codex's invocation marker wrapper.
- [ ] Name the current plan prompt files explicitly in that inventory rather
      than only by conceptual variant:
      `v1/src/modes/plan/prompts/refine.md`,
      `v1/src/modes/plan/prompts/name-only.md`,
      `v1/src/modes/plan/prompts/draft.md`,
      `v1/src/modes/plan/prompts/review.md`, and
      `v1/src/modes/plan/prompts/inline-draft.md`
      as loaded by `v1/src/modes/plan/inline-draft.ts`.
- [ ] For each named v1 prompt surface, record an explicit first-pass ownership
      call:
      move into shared prompt source verbatim in the extraction pass, keep in
      runtime code for now, or classify as minimized adapter-local prompt
      surface with snapshot coverage.
- [ ] Present the inventory in a form that makes omissions hard, such as a
      table with bucket, current surface, current source location, first-pass
      ownership call, relocation unit, and migration timing/notes.
- [ ] Make the conservative first-pass decisions explicit in the doc:
      shared prompt source for `v1/src/modes/patch/rules.md`, plan prompt
      templates plus the inline-draft template, and the stable instruction text
      currently assembled in
      `v1/src/modes/patch/prompt.ts`; runtime code for project disambiguation,
      non-index confirmation, and printed plan next-step text unless the design
      deliberately argues otherwise; adapter-local prompt surface for the Codex
      invocation marker wrapper and any equivalent transport-only framing.
- [ ] Explain how the inventory is organized by purpose and lifecycle rather
      than by mode or source tree, while still naming the current files so
      extraction work cannot miss them.
- [ ] State directly that human-facing chooser and confirmation strings remain
      part of the broader prompt-surface inventory even if the first-pass
      design keeps them in runtime code rather than under shared `prompts/`.
- [ ] For `v1/src/modes/patch/prompt.ts`, distinguish the stable instruction
      text that should move in the first pass from runtime-owned generated
      sibling-directory bullets or similar conditional formatting that should
      remain in TypeScript until a later composition phase.
- [ ] Add placeholder-free stubs for the later sections this subspec does not
      finish, including prompt layout, rendering contract, review/testing,
      versioning, migration sequence, and unresolved tradeoffs.

## Acceptance criteria

- [ ] `v2/spec/prompts.md` exists and clearly states its relationship to
      `v2/spec/v1-behaviors.md` without duplicating the behavior catalog.
- [ ] The design document defines the four-bucket prompt-surface taxonomy and
      uses it to classify the current v1 prompt surfaces named in the intent.
- [ ] The document draws a hard prompt-artifact versus runtime-code boundary
      consistent with current v1 responsibilities, including non-recursive
      placeholder substitution and write-boundary enforcement staying in code.
- [ ] Each named v1 prompt surface has an explicit first-pass ownership call:
      shared prompt source now, runtime code for now, or minimized
      adapter-local surface.
- [ ] The inventory explicitly names the current plan prompt variants
      (`refine`, `name-only`, `draft`, `review`, and `inline-draft`) instead of
      collapsing them into a generic reference to the prompts directory.
- [ ] The inventory records a relocation unit for mixed sources so the later
      extraction pass can move prompt-owned text without also moving
      runtime-generated formatting or control logic.
- [ ] The conservative extraction decisions from the intent are recorded
      directly in the design doc rather than left implicit.
- [ ] `v2/spec/prompts.md` includes substantive section stubs for later slices
      so subspecs 01 and 02 can extend the same document in place.

## Documentation updates

- [ ] Create `v2/spec/prompts.md` and author the inventory and ownership
      sections owned by this subspec.
