# 02 — External-agent spec guidance

## Problem

External agents need a stable file they can read when asked to create, migrate,
or use Jarvis specs. The guidance should explain the index-routed workflow
without requiring agents to infer it from scattered README and AGENTS.md
conventions.

## Decisions

- Add a repo-owned guidance file specifically for external agents.
- The guidance file should be stable enough to point to directly in prompts.
- The guidance should cover both creating new index-routed specs and migrating
  flat specs into the expected shape.
- This subspec does not change `jarvis run` behavior.

## Behavior

Add a documentation file that explains:

- Normal specs live at `spec/<feature>/index.md`.
- The index is the routing file and contains checklist links to atomic subspecs.
- Each subspec should be independently implementable and testable.
- Agents should read the index first, pick one unchecked subspec, complete it,
  run its verification, then check only that subspec in the index.
- Flat specs can be migrated by creating a directory, moving or splitting work
  into numbered subspec files, and adding an `index.md` that links to them.
- Direct non-index specs are an escape hatch for one confirmed agent iteration,
  not the normal workflow.

## Tasks

- [x] Add the external-agent guidance file.
- [x] Document the `spec/<feature>/index.md` routing pattern.
- [x] Document how to split work into atomic subspec files.
- [x] Document how an agent should choose and complete the next unchecked
  subspec.
- [x] Document how to migrate a flat spec into an index-routed spec directory.
- [x] Document when the one-iteration direct-spec escape hatch is appropriate.
- [x] Link the guidance file from README.
- [x] Link the guidance file from AGENTS.md.

## Acceptance criteria

- The repo contains a stable guidance file suitable for sharing with external
  agents that need to create or migrate Jarvis specs.
- README links to the guidance file.
- AGENTS.md links to the guidance file.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- README: link to the external-agent spec guidance file.
- AGENTS.md: link to the external-agent spec guidance file.
