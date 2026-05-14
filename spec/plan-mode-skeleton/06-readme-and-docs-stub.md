# 06 — README and docs stub

## Problem

After this skeleton spec merges, the `jarvis plan` command exists in
the CLI surface but does no real planning work. Users running
`--help` or scanning the README need to know that the command is
recognized, that planning behavior is not yet implemented, and where to
look for the in-flight specs. The bulk of plan-mode documentation lands
later (with each behavior spec); this subspec only lands the stubs.

## Decisions

- **`README.md` updates:**
  - Add `jarvis plan ...` to the `## Commands` block, with the same
    one-line description used in `jarvis help`.
  - Add a brief "(planning behavior is being built incrementally; see
    `spec/plan-mode-*` for in-flight work)" note immediately under that
    line.
  - Do **not** add a `## Plan mode` section yet. Behavior-level
    documentation lands with the behavior specs.
- **`docs/run-loop.md`:** add a one-paragraph forward reference under a
  new short subsection `## Plan mode` saying: plan mode is a separate
  command that authors specs (eventually); see `docs/plan-mode.md` once
  it exists. No links to nonexistent files; phrase it as "will be
  documented at `docs/plan-mode.md` once behavior lands."
- **`docs/spec-guidance.md`:** add a single sentence at the end of "Land
  the spec before implementing it" noting that `jarvis plan` will be one
  way to author specs in the future, and that the merge-first rule
  applies to plan-generated specs the same as hand-written ones.
- **`docs/config.md`:** document the new optional `planAgentOrder` key:
  type, default (omitted; falls back to `agentOrder`), validation rules,
  and the new `jarvis config set-plan-order` / `unset-plan-order`
  subcommands. Include a note that consumption (which agents actually
  run) lands in a later spec.
- **`docs/AGENTS.md`** (the one under `docs/`): no changes. Plan mode
  uses the same agent contract as patch mode; nothing to add here yet.
- **`AGENTS.md`** (top-level): no changes. The merge-first rule already
  covers plan-authored specs by extension.

## Implementation hints

- Search the README for the existing `jarvis run ...` line in the
  `## Commands` block and clone its formatting.
- `docs/config.md` may already enumerate config keys; add
  `planAgentOrder` in the same shape as `agentOrder`.

## Tasks

- [ ] Update `README.md` `## Commands` block.
- [ ] Add the brief forward-reference subsection in `docs/run-loop.md`.
- [ ] Append the one-sentence note in `docs/spec-guidance.md`.
- [ ] Document `planAgentOrder` and the new `jarvis config` subcommands
  in `docs/config.md`.

## Acceptance criteria

- [x] `README.md` lists `jarvis plan ...` in `## Commands` with the
  "incremental" note.
- [x] `docs/run-loop.md` mentions plan mode with a forward reference to
  `docs/plan-mode.md`.
- [x] `docs/spec-guidance.md` notes that plan-authored specs follow the
  merge-first rule.
- [x] `docs/config.md` documents `planAgentOrder` and the new `config`
  subcommands.
- [x] `bun run check` passes (Biome formatting).

## Documentation updates

- This subspec is the documentation update for `spec/plan-mode-skeleton/`.
