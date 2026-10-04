# 01 - Wire repo boundaries and verification

Once the v2 scaffold exists, the repo needs to enforce its boundaries and make
the existing root verification surfaces see the new tree. This slice keeps the
repo-level churn narrow: extend the root `typecheck` script, add Biome import
boundary overrides in both directions, and update the Phase 0 build-order note
to point at the concrete scaffold this spec introduced. It depends on the files
from `00`, but it should not reopen the CLI contract, wrapper shape, package
entry decisions, or root-facing command note decided there.

## Decisions

- Keep root `typecheck` wiring simple for Phase 0: invoke `tsc --noEmit -p`
  once for `v1/tsconfig.json` and once for `v2/tsconfig.json`. Do not introduce
  project references or change the repo build graph.
- Enforce v1<->v2 isolation with Biome `noRestrictedImports` overrides scoped
  per tree so both source files and co-located tests are covered.
- Restrict the lint boundary to cross-tree imports only. Do not block shared
  root-owned files or normal package imports.
- Keep the wrapper work, CLI behavior, and README note out of this slice. The
  repo-level work here is only `package.json` typecheck wiring, `biome.json`
  import boundaries, and the narrow Phase 0 documentation cross-reference in
  `v2/docs`.
- Verification should prove the existing root `bun test`, `bun run typecheck`,
  and `bun run check` surfaces now include the v2 scaffold without adding
  alternate scripts or config files.

## Task Checklist

- Extend the root `typecheck` script to cover both tsconfig projects.
- Add Biome per-tree overrides banning `v1/** -> v2/**` and `v2/** -> v1/**`
  imports, including `*.test.ts` files in both trees.
- Update `v2/docs/v2-build-order.md` so Phase 0 links back to this scaffold’s
  concrete deliverables and repo-boundary decisions.

## Acceptance criteria

- [x] The root `package.json` `typecheck` script explicitly runs both
      `tsc --noEmit -p v1/tsconfig.json` and `tsc --noEmit -p v2/tsconfig.json`,
      with no project-reference or package-entry churn beyond that.
- [x] `biome.json` contains per-tree `noRestrictedImports` overrides that ban
      imports from `v1/**` into `v2/**` and from `v2/**` into `v1/**`,
      including co-located test files in both trees, while still allowing shared
      root-level modules and ordinary package imports outside those trees.
- [x] The spec’s verification surface is the existing root commands only:
      `bun test` discovers and runs the new co-located `v2/src/*.test.ts` file,
      `bun run typecheck` covers both trees, and `bun run check` enforces the
      import-boundary rules without any new root test or lint scripts.
- [x] `v2/docs/v2-build-order.md` is updated so Phase 0 names the concrete
      scaffold deliverables seeded by this spec: `v2/tsconfig.json`,
      `v2/src/cli.ts`, the co-located v2 test shape, `bin/jarvis`, the root
      `typecheck` coverage, and the Biome import boundary.

## Documentation updates

- Update [v2/docs/v2-build-order.md](/Users/christopherbrenner/Work/jarvis/.worktree/plan-v2-engine-scaffold/v2/docs/v2-build-order.md)
  to reference the exact Phase 0 scaffold deliverables and the boundary wiring
  they rely on.
