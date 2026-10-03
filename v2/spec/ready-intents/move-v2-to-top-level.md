---
name: move-v2-to-top-level
---

# The engine tree lives at the repository top level, not under `v2/`

## Problem

`v1` is frozen and there will never be a `v3`, yet the only engine lives under `v2/` (`v2/src`, `v2/spec`, `v2/docs`) with the label baked into `package.json` scripts (`test:v2`, `test:integration:v2`, `coverage:v2`), `scripts/ci-test-scope.ts`, tsconfig paths, `.markdownlint-cli2.jsonc` globs, `.github/workflows/ci.yml`, 31 root scripts, and the `plan.targetDir` default. AGENTS.md forbids planning labels in identifiers and paths.

Unsplit rationale: a tree move is atomic; half-moved code does not typecheck, so paths, imports, scripts, CI scope, lint globs, and guards change together.

## Decisions

- Move `v2/src` → `src`, `v2/spec` → `spec`, `v2/docs` → `docs` in one change, updating every import, tsconfig path, script, guard, lint glob, CI scope rule, and prompt path reference.
- Plan must decide the new script names (the seed says `test`-slice names, e.g. `test:v2` → a non-versioned slice name) without colliding with the existing aggregate `bun run test`.
- The in-repo `plan.targetDir` default and the jarvis project's registered `plan.targetDir` move to `spec`; the latter is operator config in `~/.jarvis/config.json`, re-pointed by hand and documented, not edited by the implementation.
- `v1/` and `v1-behaviors.md` keep their names; `v1/**` is untouched.

## Prerequisites

- One runtime tree to move (delivered by: shared-test-slices-fold-into-v2-slices)

## Acceptance criteria

- [ ] No tracked path under `v2/` remains; imports, tsconfig paths, scripts, guards, lint globs, and CI scope rules resolve at the top-level paths.
- [ ] `package.json` has no `*:v2` script; `scripts/ci-test-scope.test.ts` pins the renamed slices for a change under `src/`.
- [ ] `plan-target-dir` tests pin the `spec` default; the install doc names the operator re-point of `plan.targetDir`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `AGENTS.md` — layout and test-scope rules at the new paths.
- `docs/install-and-config.md` — re-point `plan.targetDir`; `docs/**` and `spec/reliability-*.md` path references.
- `docs/v1-behaviors.md` — record the move.

## Primary implementation surface

- `v2/**` → top level; `package.json`, `tsconfig*.json`, `.markdownlint-cli2.jsonc`, `.github/workflows/ci.yml`, `scripts/ci-test-scope.ts`, `scripts/guard-*.ts`, `shared/plan-target-dir.ts`, `shared/prompts/**`
