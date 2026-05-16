# 14 — Code quality tooling

Add a formatter and linter for this Bun + TypeScript repo.

## Decision

Use Biome instead of separate Prettier + ESLint packages.

Reasons:

- One dev dependency covers formatting, linting, and import organization.
- It supports TypeScript, JSON, Markdown-adjacent project files, and Bun-friendly CLI usage.
- It keeps this small personal harness from carrying separate formatter/linter configs and dependency trees.

If implementation finds a real rule gap that matters for this repo, document the gap here before adding ESLint.

## Tasks

- [ ] Add `@biomejs/biome` as an exact dev dependency.
- [ ] Add a committed Biome config at the repo root with:
  - formatting enabled,
  - linting enabled,
  - recommended lint rules enabled,
  - generated/dependency/build output ignored.
- [ ] Add package scripts:
  - `lint` checks lint rules without writing files,
  - `format` writes formatting fixes,
  - `format:check` verifies formatting without writing files,
  - `check` runs the full non-writing code-quality check suitable for local verification/CI.
- [ ] Run the formatter once on project-owned source, test, config, docs, and spec files.
- [ ] Fix any lint findings without changing harness behavior beyond what this subspec authorizes.
- [ ] Keep existing `typecheck`, `test`, and `start` scripts working.

## Acceptance criteria

- `bun install` succeeds and updates the lockfile.
- `bun run lint` exits 0.
- `bun run format:check` exits 0.
- `bun run check` exits 0.
- `bun run typecheck` exits 0.
- `bun test` exits 0.

## Documentation updates

- Update the README "Development" section to list the new code-quality scripts.
- Mention that Biome is the repo's formatter/linter and should be run before marking specs complete.
