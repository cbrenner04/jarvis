# 01 — Repoint root entrypoints and TypeScript ownership to v1

## Problem

After the move, the repo still has to look the same from the outside. Existing symlinks target `bin/jarvis` at the repo root, CI and humans still run root `bun` scripts, and the current single root `tsconfig.json` would otherwise keep owning the source tree. Without an explicit compatibility layer, the structural move would break entrypoints or accidentally leave the root as a second implementation home.

This slice defines the root contract after the split: one package manifest, one dependency tree, root-owned forwarding entrypoints, and a dedicated `v1` TypeScript project.

## Decisions

- Preserve a single root `package.json`, `bun.lock`, and `node_modules`. Do not add Bun workspaces and do not add per-version manifests.
- Keep the package `bin` contract anchored at root `bin/jarvis`.
- Preserve the current symlink-safe wrapper behavior in `bin/jarvis`: it must continue resolving chained symlinks exactly as it does today, changing only the final Bun target from root `src/cli.ts` to the v1 CLI path.
- Root command names stay the same in this step:
  - `bun run typecheck`
  - `bun test`
  - `bun run check`
  - `bun run ready`
  - `bun run start`
  - `bun run install-opencode-permissions`
- The current root-owned implementation entrypoints must be repointed to v1. Today those are:
  - `package.json` `"module": "src/index.ts"`
  - `package.json` `"start": "bun run src/index.ts"`
  - `package.json` `"typecheck": "tsc --noEmit"`
  - `package.json` `"test": "bun test --timeout=30000"`
  - `package.json` `"ready": "bun scripts/ready.ts"`
  - `package.json` `"install-opencode-permissions": "bun run scripts/install-opencode-permissions.ts"`
  - `bin/jarvis` dispatch to `../src/cli.ts`
- `bun run check` stays rooted at `.` because the repo still has one formatter/linter surface, but that does not make the root an implementation home. Any root-owned helper introduced by this slice must be forwarding glue only.
- Thin root shims are allowed only as forwarding glue. The real v1 implementation must live under `v1/src/` and `v1/scripts/`, not remain at root `src/` or `scripts/`.
- Forwarding glue means either:
  - `package.json` entries that point directly at `v1/...`, or
  - new root helper files whose only responsibility is invoking `v1/...` and returning its exit status unchanged.
  Any additional root logic is out of scope for this split.
- Split TypeScript ownership explicitly:
  - root `tsconfig.base.json` contains shared compiler options only
  - `v1/tsconfig.json` extends the base file and owns the `include` globs for v1 source/tests
  - root `typecheck` targets `v1/tsconfig.json` explicitly
- If a root `tsconfig.json` remains, it is a non-authoritative wrapper only and must not redefine the v1 source-tree include contract or accidentally sweep `v2/` into this step’s typecheck.
- Keep the root lint/format contract structurally identical. `bun run check` continues to run against `.`; any new `v2/` files introduced by the split must already satisfy the existing Biome rules.
- Preserve current CI shape where possible. `.github/workflows/ci.yml` should keep calling the same root commands, with only path-target updates behind those commands if needed.

## Tasks

- [ ] Repoint root package entrypoints and scripts so the existing command names forward into `v1/...` behavior.
- [ ] Update `bin/jarvis` to keep its symlink-resolution wrapper intact while dispatching to the v1 CLI path.
- [ ] Ensure the root `test` entry continues to execute the v1 test suite after `test/` moves under `v1/`, either by targeting `v1/test` directly or by routing through a thin forwarding shim.
- [ ] Move `scripts/ready.ts` and `scripts/install-opencode-permissions.ts` into `v1/scripts/`, then update root callers or shims to invoke them there.
- [ ] Introduce `tsconfig.base.json` at the root and `v1/tsconfig.json` for the v1 source tree.
- [ ] Decide explicitly whether the repo keeps a root `tsconfig.json`; if it remains, reduce it to a non-authoritative wrapper that cannot become a second source-tree config.
- [ ] Make the root `typecheck` entry explicitly validate v1 only in this step.
- [ ] Preserve the existing workflow and root script contracts used by CI.

## Documentation updates

- Update any command-surface documentation that explains how root scripts or the launcher resolve after the split.
- Note that the repo still has one package and one dependency tree even though `v1/` and `v2/` are separate source trees.

## Acceptance criteria

- [ ] `package.json` remains the only package manifest in the repository and still exposes `bin/jarvis` from the root package.
- [ ] `bin/jarvis` preserves the current symlink-safe wrapper behavior and now dispatches into the v1 CLI path, so existing PATH symlinks continue to work.
- [ ] Root script names remain unchanged, but `module`, `start`, `typecheck`, `test`, `ready`, and `install-opencode-permissions` now resolve into `v1/` code or new forwarding shims whose only job is dispatching into `v1/`.
- [ ] The real implementations of the current product entrypoints no longer live in root `src/` or root `scripts/`; those trees now live under `v1/`.
- [ ] The repo has a root `tsconfig.base.json` for shared compiler options and a `v1/tsconfig.json` that owns the v1 include globs.
- [ ] If a root `tsconfig.json` still exists after the split, it does not own source-tree includes for `v1/` or `v2/`; `v1/tsconfig.json` remains the authoritative v1 project config.
- [ ] `bun run typecheck` targets `v1/tsconfig.json` explicitly and does not implicitly typecheck `v2/` in this step.
- [ ] `bun test` from the repo root still runs the v1 test suite after the move and does not depend on leaving the real tests at the repo root.
- [ ] `bun run check` continues to run from the repo root against `.` and succeeds with the new `v2/` documentation/spec files included in the same formatter/linter surface.
- [ ] `.github/workflows/ci.yml` still validates the repo through the familiar root commands rather than a new per-version workflow shape.

## Out of scope

- Adding a v2 TypeScript project beyond inert scaffolding needed for the split.
- Renaming CLI commands or changing any user-visible output.
- Redesigning the CI workflow beyond path/script repointing required by the move.
