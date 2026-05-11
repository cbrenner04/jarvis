# 02 — Documentation updates

## Problem

Subspec 00 documents the recommended commit-spec-first flow in
`docs/spec-guidance.md`. Subspec 01 adds a runtime prompt to `jarvis run`.
User-visible documentation for the prompt itself (in the run-loop and
README) is still missing.

## Decisions

- The runtime prompt is documented alongside the existing non-index prompt
  in `docs/run-loop.md`. Treat both as part of "what `jarvis run` may ask
  you at startup".
- The README does **not** describe the prompt text in detail. It gets a
  one-line mention in the `jarvis run` section pointing to the run-loop
  doc, matching the existing pattern.

## Behavior

After this subspec:

- `docs/run-loop.md` has a new subsection titled **"Startup prompts"** (or
  similar) that documents:
  - the existing non-index spec prompt
  - the new spec-tracking prompt from subspec 01, including:
    - what triggers it (untracked or modified spec on the base branch)
    - the choices (`y`/`N`, default `N`)
    - the non-TTY warn-and-continue behavior
    - a pointer to the commit-spec-first section in
      `docs/spec-guidance.md`
- The `README.md` `jarvis run` paragraph gains one sentence: *"`jarvis run`
  may warn you at startup if the spec is uncommitted on the base branch.
  See [docs/run-loop.md](docs/run-loop.md) and
  [docs/spec-guidance.md](docs/spec-guidance.md) for the recommended
  commit-spec-first workflow."* Wording can be adjusted as long as both
  doc links and the "commit-spec-first" framing remain.

## Tasks

- [ ] Add the "Startup prompts" subsection to `docs/run-loop.md` covering
  both prompts.
- [ ] Add the one-sentence pointer to the `jarvis run` section of
  `README.md`.
- [ ] Verify markdown anchors used by the cross-links from subspec 00 still
  resolve. Adjust headings or anchor references if needed.
- [ ] `bun run check` passes.

## Acceptance criteria

- `docs/run-loop.md` documents the new prompt and links to
  `docs/spec-guidance.md#commit-specs-before-running-jarvis`.
- `README.md` gains a single pointer sentence and does not duplicate the
  prompt text.
- All cross-links between `README.md`, `docs/run-loop.md`, and
  `docs/spec-guidance.md` resolve.
- `bun run check` passes.

## Documentation updates

This subspec **is** the documentation update. No code changes.
