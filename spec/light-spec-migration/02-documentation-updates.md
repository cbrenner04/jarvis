# 02 — Documentation updates

## Problem

Subspecs 00 and 01 change observable `jarvis run` behavior for non-index
specs. The "Direct Spec Escape Hatch" section in
[docs/spec-guidance.md](../../docs/spec-guidance.md) describes the old
"run anyway" path and must be replaced. `AGENTS.md` and `README.md` may also
mention the old behavior.

This subspec lands the doc changes in one pass once the implementation is in.

## Decisions

- `docs/spec-guidance.md` is the canonical guidance for external agents
  asked to migrate flat specs. Its existing "Migrating Flat Specs" section is
  the procedure the migration prompt in subspec 01 points agents at — keep it
  authoritative; expand only if the migration agent needs more detail to
  reshape specs faithfully.
- The "Direct Spec Escape Hatch" section is removed and replaced with a
  short "Non-index spec handling" section describing the new three-way
  prompt (`s` / `m` / `e`).
- `AGENTS.md` gets a brief note under "Conventions for spec files in *this*
  repo" pointing at the new behavior, only if the existing text references
  the old escape hatch. Otherwise no change.

## Tasks

- [ ] Replace the "Direct Spec Escape Hatch" section in
  `docs/spec-guidance.md` with a "Non-index spec handling" section that
  documents the `s` / `m` / `e` prompt and that migration runs as a single
  agent iteration.
- [ ] Audit `docs/spec-guidance.md` "Migrating Flat Specs" for anything the
  migration agent will need beyond what is already there (e.g. explicit
  in-place vs. side-by-side guidance). Tighten if needed; do not rewrite.
- [ ] Audit `AGENTS.md` and `README.md` for stale references to the
  `[y/N]` escape hatch. Update only what is stale.

## Acceptance criteria

- `docs/spec-guidance.md` no longer describes a "run anyway" path.
- The new prompt's behavior is documented in one place an external agent can
  find from the spec path alone.
- No other docs reference the removed `[y/N]` prompt.
- `bun run typecheck` and `bun test` still pass.

## Documentation updates

- This subspec *is* the documentation update.
