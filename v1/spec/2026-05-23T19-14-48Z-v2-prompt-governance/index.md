# V2 prompt governance

repo: cbrenner04/jarvis

Produce `v2/spec/prompts.md` as the reviewable design for shared prompt
governance across `jarvis1` and v2, then author the follow-on implementation
intents under `v2/spec/wip-intents/` needed to extract existing v1 prompt
artifacts and add prompt registry, renderer, snapshot, and revision support.

This tree follows `v2/spec/v1-behaviors.md`, `v2/spec/v2-vision.md`, and
`v2/spec/wip-v2-musings.md`. It should stay focused on prompt ownership,
rendering, reviewability, testing, versioning, and migration mechanics rather
than rewriting prompt wording or recataloging user-observable behavior.

## Subspecs

- [x] [00 — Prompt surface inventory and ownership boundaries](./00-prompt-surface-inventory-and-ownership.md)
- [x] [01 — Rendering contract, prompt IDs, revisions, and snapshots](./01-rendering-contract-ids-revisions-and-snapshots.md)
- [ ] [02 — Migration sequence, follow-on intents, and final consolidation](./02-migration-intents-and-final-consolidation.md)

## Conventions

- Land this tree as a spec-only PR before any prompt extraction or v2 prompt
  runtime work begins.
- Keep `v2/spec/prompts.md` as one cohesive design doc. Later subspecs should
  extend or refine sections in place instead of splitting the governance design
  across multiple docs.
- Treat the current v1 source as the authority for today's prompt surfaces and
  ownership boundaries. Use `v2/spec/v1-behaviors.md` for behavioral context,
  not as a duplicate prompt inventory.
- Name current v1 prompt surfaces explicitly when the intent already does so.
  Do not collapse the plan prompt set into a generic directory reference if
  that would make `refine`, `name-only`, `draft`, `review`, or `inline-draft`
  easy to miss.
- When a current source mixes prompt-owned text with runtime formatting, record
  that split explicitly. The later relocation pass must be able to move the
  prompt-owned text without accidentally moving conditional rendering logic.
- Keep the prompt-surface inventory purpose- and lifecycle-oriented. The design
  may cite source files to anchor current surfaces, but it should not devolve
  into a file-by-file implementation tour.
- Make first-pass ownership calls explicit. For every named v1 prompt surface,
  say whether the first extraction pass moves it into shared prompt source
  verbatim, keeps it in runtime code for now, or classifies it as minimized
  adapter-local prompt surface.
- Stable prompt IDs and revision signals are part of the runtime contract, not
  a documentation flourish. The design and follow-on intents should treat
  duplicate IDs, missing IDs, and unknown step references as hard validation
  failures.
- Human-facing chooser and confirmation strings still belong in the surface
  inventory even if the first prompt registry and snapshot rules exclude them
  from shared prompt artifacts.
- Keep relocation-only extraction separate from renderer/versioning/composition
  work. The first implementation pass must be auditable as a no-wording-change
  move.
- The final migration section should choose exact immediate follow-on intent
  filenames and make any layered-composition deferral explicit.
- Treat layered fragment composition as a later migration step unless the spec
  can justify a separate, atomic follow-on intent for it. Do not blur
  relocation-only extraction together with new composition semantics.
- Snapshot testing in this tree means deterministic rendered-prompt and wrapper
  coverage, not broad prompt eval infrastructure.
- If blocked, append `## Blocker` to the active subspec and stop.
