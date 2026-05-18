# 01 — Update developer docs for the pre-ready gate

## Problem

`README.md` is the canonical script index and currently:

- Does not list the new Biome fix scripts.
- Documents `test:full` (which subspec 00 removes).
- Mis-describes `check` as "the full non-writing Biome code-quality check" (Biome `check` covers lint + format + import sort, not typecheck/test).
- Tells readers to "Run `bun run check` before marking specs complete" — that's no longer the right gate; `bun run ready` is.

`AGENTS.md:51` says "Run `bun run typecheck` and `bun test` before ticking the acceptance criteria they cover." This is per-iteration agent-loop guidance and is **different** from the human draft→ready gate. Leave AGENTS.md:51 alone (or only minimally clarify) and add the ready-script guidance as a separate, clearly human-targeted note.

## Decisions (locked)

- README rewrite of the Development section (currently around `README.md:277-289`) is the primary documentation deliverable.
- Call out the existing Biome script naming asymmetry in the README so readers are not surprised: `format` writes by default; `check` and `lint` are read-only and have `:fix` (and `:fix:unsafe`) variants.
- Describe `:unsafe` variants explicitly as developer convenience: run after the corresponding `--write` variant, inspect the resulting diff, and only keep changes that are acceptable.
- Add a short note distinguishing the per-iteration gate (`typecheck` + `test`) from the draft→ready gate (`bun run ready`). Put this in AGENTS.md only if it can be done in one or two added sentences without rewriting line 51's per-iteration guidance.

## Tasks

- [ ] In `README.md`'s Development section:
  - [ ] List all five new scripts (`check:fix`, `check:fix:unsafe`, `format:unsafe`, `lint:fix`, `lint:fix:unsafe`) with one-line descriptions.
  - [ ] Replace the `test:full` bullet with a `ready` bullet described as "mirrors CI: install (frozen lockfile), typecheck, test, check. Run before flipping a PR out of draft."
  - [ ] Fix the `check` description so it accurately says lint + format + import sort (not "the full non-writing Biome code-quality check").
  - [ ] Replace "Run `bun run check` before marking specs complete" with guidance pointing to `bun run ready` as the draft→ready gate.
  - [ ] Add a short note on the `format` vs `check`/`lint` naming asymmetry, and on inspecting `:unsafe` diffs before committing.
- [ ] In `AGENTS.md`, add (do not replace line 51) a brief note that flipping a PR from draft to ready is gated by `bun run ready`, distinct from the per-iteration `typecheck`/`test` loop. One or two sentences max.

## Acceptance criteria

- [ ] `README.md` Development section lists the five new Biome scripts and the new `ready` script with accurate one-line descriptions.
- [ ] `README.md` no longer references `test:full`.
- [ ] `README.md`'s description of `check` no longer claims it is "the full non-writing Biome code-quality check"; it accurately names lint + format + import sort.
- [ ] `README.md` directs readers to run `bun run ready` before flipping a PR out of draft (not `bun run check`).
- [ ] `README.md` notes that `:unsafe` variants should be run after the `--write` variant and their diffs inspected before commit.
- [ ] `AGENTS.md:51`'s per-iteration guidance is preserved; any added text clearly distinguishes the draft→ready gate from the per-iteration gate.
- [ ] All script names referenced in updated docs exist in `package.json` after subspec 00 lands.

## Out of scope

- Editing CI configuration or workflow files.
- Broader README restructuring beyond the Development section.
- Rewriting AGENTS.md beyond a one-or-two-sentence addition.
