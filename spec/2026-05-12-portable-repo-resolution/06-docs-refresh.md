# 06 - Documentation refresh

## Problem

Several docs still mandate `repo: <absolute-local-path>` and assume the
worktree + commit + PR flow is unconditional. After the previous subspecs
ship, the docs need a coherent pass so new readers find consistent guidance.

This subspec is a sweep: each preceding subspec already updates the parts of
the docs it directly affects. This one closes gaps, removes any remaining
absolute-path examples, and ensures cross-references are correct.

## Decisions

- Replace every example of `repo: /absolute/...` in committed docs with a
  URL example or remove the line entirely where the example would read more
  naturally without it.
- Top-level `README.md` quickstart should show the URL form and note that
  `repo:` is optional.
- `docs/spec-guidance.md` should describe the resolution order at a high
  level and link to `docs/run-loop.md` for the authoritative flow.
- `AGENTS.md` should be updated wherever it references the absolute-path
  shape.
- Do not touch existing spec files under `spec/` other than the ones in this
  spec dir; old specs are historical record.

## Task Checklist

- [ ] Search the repo for `repo: /` occurrences in non-spec docs and
  replace.
- [ ] Update `README.md` quickstart and command sections.
- [ ] Update `docs/spec-guidance.md`, `docs/run-loop.md`,
  `docs/worktrees-and-commits.md`, `docs/config.md`.
- [ ] Update `AGENTS.md` references.
- [ ] Verify cross-links between docs still resolve.

## Acceptance criteria

- [x] No file under `docs/`, the repo root README, or `AGENTS.md` shows
  `repo: /` (absolute-path) examples.
- [x] `README.md` quickstart shows a URL-form `repo:` example and notes the
  field is optional.
- [x] `docs/spec-guidance.md` describes the resolution order at a high level
  and links to `docs/run-loop.md`.
- [x] `docs/run-loop.md` is the authoritative description of resolution,
  prompt behavior, completion semantics, and the `--cwd` flag.
- [x] `docs/worktrees-and-commits.md` makes its `git: true` precondition
  explicit at the top.
- [x] `docs/config.md` shows the `git` field, per-project override, and
  `Project.origin?` field in the schema block.
- [x] `bun run check` passes.

## Documentation updates

- This subspec is itself the documentation-updates subspec; the bullets
  above are the doc work.
