# 02 — Update repo docs, spec topology, and verification for the split

## Problem

The split changes where humans and agents look for code, specs, and planning material. Without explicit documentation and verification rules, the repo would become structurally correct on disk but misleading to contributors and future v2 planning work. This step also needs to codify the manual smoke-test bar that proves the root compatibility layer still behaves like today’s `jarvis`.

## Decisions

- Treat `README.md` and `AGENTS.md` updates as part of the structural migration, not optional cleanup.
- Keep repo-level guidance files at the root:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `README.md`
  - `CODEOWNERS`
- Update those docs to explain:
  - the new top-level layout
  - that root `jarvis` entrypoints still execute v1 in this step
  - that v2 planning material now lives under `v2/spec/`
  - that future v2 implementation work should land under `v2/`, not by reusing root paths
- Describe the spec topology as a full-tree relocation plus carveout:
  - `v1/spec/` becomes the home for completed history and remaining v1-oriented planning/spec work
  - `v2/spec/wip-intents/` becomes the home for long-lived v2 planning materials migrated in this step
  - this split plan’s `intent.md` becomes v2 planning material under `v2/spec/wip-intents/split-v1-v2-repo-intent.md`, while the rest of the plan tree remains implementation history under `v1/spec/`
- Preserve the “no behavior change” rule for path-sensitive assets and documentation references. Update links and runtime path references only as required to keep behavior and docs correct after the move.
- Verification for this structural change is the existing root gate plus manual CLI smoke tests:
  - `bun run typecheck`
  - `bun test`
  - `bun run check`
  - `bun run ready`
  - `bin/jarvis help`
  - one harmless read-only/config command such as `bin/jarvis config show` or equivalent
- Because this spec is structural, any failures in the smoke-test phase that reveal behavior drift are in scope to fix before closing the implementation.

## Tasks

- [ ] Update root documentation and repo guidance to describe the split layout and the root compatibility contract.
- [ ] Update any moved v1 docs so cross-links and path references remain correct from their new `v1/` location.
- [ ] Document where v1 specs now live versus where v2 planning material now lives.
- [ ] Update documentation that currently describes the repo as a single root-owned harness so it reflects the new root glue plus `v1/`/`v2/` split without changing the user-facing CLI story.
- [ ] Add or adjust focused tests if needed for moved-path assumptions or launcher/help behavior that the structural split could silently break.
- [ ] Run the specified verification and smoke-test commands during implementation of the split.

## Documentation updates

- Refresh `README.md` installation and layout language so it explains the root `bin/jarvis` shim and the `v1/` / `v2/` split.
- Refresh `AGENTS.md` instructions that currently describe “this repo contains only the harness” at the root, so future agents understand that the current shipping harness now lives under `v1/` while the repo root owns shared glue and v2 planning space.
- Update any relevant docs under `v1/docs/` that mention root-relative source/spec locations.

## Acceptance criteria

- [ ] `README.md` documents the new repo layout, keeps the root installation story intact, and makes clear that `jarvis` still runs the v1 engine after the split.
- [ ] `AGENTS.md` remains at the repo root and is updated to reflect the `v1/` plus `v2/` layout and the workflow expectations that follow from that split.
- [ ] The split documents the exact ownership of specs: non-v2 history/planning under `v1/spec/`, v2 planning materials under `v2/spec/wip-intents/`, and this split plan’s `intent.md` specifically under `v2/spec/wip-intents/split-v1-v2-repo-intent.md`.
- [ ] Any root or moved documentation links/path references affected by the relocation are updated so they resolve correctly after the move.
- [ ] Focused tests cover any path-resolution or command-surface regressions introduced by the split where unit coverage is practical.
- [ ] The implementation records successful verification of `bun run typecheck`, `bun test`, `bun run check`, `bun run ready`, `bin/jarvis help`, and one harmless read-only/config subcommand from the repo root after the move.
- [ ] The final repo shape preserves behavior at the command boundary: from a user’s perspective, root `jarvis` commands behave the same as before even though the implementation now lives under `v1/`.

## Out of scope

- The later `jarvis` → `jarvis1` rename.
- Writing v2 source code.
- Broader v2 architecture decisions beyond preserving and documenting the split boundary.
