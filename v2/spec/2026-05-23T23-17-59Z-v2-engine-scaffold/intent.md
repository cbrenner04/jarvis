---
name: v2-engine-scaffold
---

Stand up the v2 engine scaffold — Phase 0 of `v2/docs/v2-build-order.md` and the
first `v2/src` work. Must land before everything else, since every later phase
compiles inside it.

Goal: a v2 tsconfig project with a near-empty `v2/src`, co-located tests, a
resolvable `jarvis` binary that prints version / "v2 not ready", enforced
v1<->v2 import isolation, and CI typecheck coverage. No engine behavior — no
daemon, state, or commands beyond version.

Constraints and decisions:

- One package, many trees. `v2/tsconfig.json` extends `../tsconfig.base.json`
  like v1 does — same strictness, no loosening.
- Tests co-located as `*.test.ts` under `v2/src` (no `v2/test/` tree), run by
  the existing `bun test`.
- `bin/jarvis` mirrors the `bin/jarvis1` bash wrapper (resolve symlinks, then
  `exec bun run` the v2 TS entry directly — no build step, same as `jarvis1`)
  and is added to the `package.json` `bin` map. `jarvis1` stays untouched as the
  daily driver.
- Extend the root `typecheck` (currently v1-only) to cover v2 so `ready`/CI
  catch v2 type errors.
- Enforce v1<->v2 import isolation with Biome `noRestrictedImports` via per-tree
  `overrides` (bans cross-tree imports both directions; runs under `check`, no
  new deps). Note: tsc `include` scoping alone does not enforce this — tsc
  follows imports past `include`.
- No stack churn; keep it minimal; do not scaffold future phases.

Scope: create `v2/tsconfig.json`; a minimal `v2/src` entry plus one co-located
test; `bin/jarvis` + its `package.json` entry; extend `typecheck`; add the Biome
boundary overrides both directions. Cross-reference Phase 0 in
`v2/docs/v2-build-order.md`.

Out of scope (Phases 1+): daemon, IPC, SQLite state, prompt wiring, any
behavior or workflow logic, TUI.

## Refine turn 1

- Current repo touchpoints are narrow: root `package.json` only exports
  `jarvis1`, root `typecheck` only runs `tsc --noEmit -p v1/tsconfig.json`,
  `biome.json` has no per-tree overrides yet, and `v1/tsconfig.json` is only a
  thin `extends` + `include` wrapper. Draft the work against those files plus
  the new `v2/` tree; avoid unrelated root script or module-entry churn.
- `package.json` currently has no `version` field, so "prints version" is not a
  free behavior. The draft should define the exact minimal CLI contract instead
  of assuming an existing version source. Keep it Phase-0-small: support
  `jarvis --version` plus a no-arg invocation that prints an explicit
  "v2 not ready" message, and pin stdout/stderr and exit-code expectations in
  acceptance criteria.
- Prefer the lowest-churn typecheck wiring. Extending the root `typecheck`
  script to invoke both `v1/tsconfig.json` and `v2/tsconfig.json` explicitly is
  enough for Phase 0; there is no need to introduce TypeScript project
  references or broader repo build-graph changes yet.
- The Biome boundary rule should apply to both source and colocated test files
  in each tree and ban cross-tree imports in both directions. There are no path
  aliases today, so the draft can keep this to relative/import-specifier
  boundaries only and does not need new resolver policy.
- Verification should stay Phase-0-local: one colocated `v2/src/*.test.ts`
  smoke test around the minimal entry behavior, plus acceptance criteria that
  prove the existing root `bun test`, `typecheck`, and `check` surfaces now see
  the new tree.

## Refine turn 2

- Keep the root package boundary stable. `package.json` currently points
  `module` and `start` at `v1`; Phase 0 does not need to repoint either of
  those, add exports, or otherwise make v2 the package-default module. The new
  v2 surface is only the `bin/jarvis` shim plus the explicit root `typecheck`
  script coverage.
- Mirror the existing entrypoint shape, not the placeholder `v1/src/index.ts`.
  The wrapper contract in this repo is "shim execs a CLI file", so the draft
  should anchor the near-empty implementation at `v2/src/cli.ts` and treat any
  `v2/src/index.ts` as optional/internal only if needed by tests. That keeps the
  bash wrapper, CLI behavior, and test target aligned.
- The version source needs to be explicit in the draft. There is still no root
  `package.json` `version`, and Phase 0 should avoid inventing git-derived or
  build-time version plumbing. The lowest-churn choice is to add a root
  `version` field and have `jarvis --version` print that exact string to stdout
  with exit code 0 and no stderr output.
- Pin the no-arg contract just as tightly: `jarvis` with no arguments should
  print the explicit `v2 not ready` message to stdout, exit 0, and avoid extra
  help text, banners, or stack traces. Unknown flags/subcommands are out of
  scope for this phase unless the draft wants to reject them uniformly with the
  same "not ready" boundary.
- Keep verification at the CLI-function boundary, not the shell-wrapper
  boundary. The colocated test can exercise the v2 CLI entry/module directly
  under Bun and assert the stdout/stderr/exit-code contract for no-arg and
  `--version`; the spec does not need additional subprocess coverage for
  symlink resolution because `bin/jarvis1` already established that wrapper
  pattern and Phase 0 is intentionally reusing it.
- Documentation scope should stay narrow too. Besides cross-referencing Phase 0
  in `v2/docs/v2-build-order.md`, the draft should call for only the minimal
  root-facing docs needed so a reader can discover that `jarvis1` remains v1
  while bare `jarvis` is now reserved for the v2 scaffold. Avoid broader v2
  architecture/doc churn in this first spec.

## Refine turn 3

- Keep the import boundary rule precise: ban `v1/** -> v2/**` and `v2/** ->
  v1/**`, including colocated tests in both trees, but do not accidentally ban
  imports from shared root-level files or packages. Phase 0 is about tree
  isolation, not forbidding legitimate shared dependencies like package imports
  or future root-owned utilities outside `v1/` and `v2/`.
- Draft the acceptance criteria so they prove Bun discovers the new colocated
  `v2/src/*.test.ts` file through the existing root `bun test` command without
  any new test script, config file, or alternate test root. The scaffold should
  fit the repo's current zero-extra-wiring test surface.
- Keep the wrapper work literal: `bin/jarvis` should mirror `bin/jarvis1`'s
  symlink-resolution and `exec bun run <cli>` structure, but swap only the
  target path to `v2/src/cli.ts`. The draft should avoid expanding this into a
  shared wrapper helper or touching `bin/jarvis1`.
- The CLI surface should remain a two-path boundary in Phase 0: no-arg prints
  the fixed "v2 not ready" message, `--version` prints the root package version.
  Any other argv shape should be explicitly treated in the draft as out of scope
  unless the author chooses to normalize it to the same "v2 not ready" response
  for simplicity.
- Root-facing docs should stay discoverability-focused. The draft can limit this
  to a small note in an existing root or v1-facing doc that explains `jarvis1`
  is still the real driver and bare `jarvis` now resolves to the v2 scaffold.
  It does not need a new standalone v2 usage guide.

