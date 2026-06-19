# 00 - Define documentation placement and inline standard

v2 already commits to "Documented in code" (`v2/docs/v2-vision.md`) as a guiding
principle, but the principle is undefined: nothing states what "well documented"
means or what documentation belongs inline versus in durable docs versus in
specs. Next to it sits "Be terse," with no scope qualifier. An agent reading both
resolves the tension by under-documenting code. The other subspecs in this set
(docs-first ordering, terse PRs) assume this definition exists; it does not yet.

Write the operational definition once, in a durable home, and encode the
enforceable part as a shared prompt fragment so it binds both engines (v1 today,
v2 when its write loop lands — `prompts/` is shared and read by both).

Two distinct ideas to capture:

- **Inline standard** — the quality bar for in-code documentation: doc-comment
  every exported symbol (contract: purpose, params, returns, errors,
  invariants); comment *why*, not *what*; do not narrate obvious code; a comment
  earns its place only when it says something the code cannot.
- **Placement policy** — what lives where. Single-symbol/single-line concerns are
  inline; cross-file architecture, component contracts, operator/workflow
  behavior, and design decisions live in durable docs (`v2/docs/`); intents and
  acceptance contracts live in specs. A behavior is documented in exactly one
  durable home — cross-link, never duplicate.

## Task checklist

- Add a durable doc (e.g. `v2/docs/documentation-standard.md`) stating the inline
  standard and the placement policy, with a concise concern -> location table.
- Cross-link `v2/docs/v2-vision.md` "Documented in code" to that doc as its
  operational definition.
- Add a shared prompt fragment (e.g. `prompts/global/documentation.md`,
  `global.documentation`) encoding the standard and placement rule tersely,
  registered per `v1/docs/prompt-governance.md` (frontmatter, registry, renderer
  assembly as a layered global fragment alongside `global.terse`).
- Scope the terse directive so "terse" governs communication artifacts (specs,
  PRs, commits, intents) and explicitly does not authorize under-documenting code
  or omitting required docs.
- Update prompt governance and rendered-prompt snapshot coverage for the new
  fragment.

## Acceptance criteria

- [x] A durable doc defines the inline standard (doc-comment every exported
      symbol; comment why not what; no narration of obvious code) and a placement
      table mapping each concern to inline, `v2/docs/`, or spec.
- [x] The placement policy states each behavior is documented in exactly one
      durable home and cross-linked rather than duplicated.
- [x] `v2/docs/v2-vision.md` "Documented in code" cross-links the durable doc as
      its operational definition.
- [x] A shared prompt fragment encodes the standard and placement rule and is
      registered and rendered as a layered global fragment per prompt governance.
- [x] The terse directive is scoped to communication artifacts and does not read
      as license to under-document code.
- [x] Rendered prompt snapshot tests fail before the fragment is added and pass
      after the new wording is accepted.
- [x] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

Create the durable standard doc and cross-link it from `v2/docs/v2-vision.md`.
Update `v1/docs/prompt-governance.md` to register the new shared fragment and
record the scoped meaning of the terse directive.
