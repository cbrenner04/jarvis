# 00 — Relocate engine trees and retire `v2` path and script labels

## Problem

The live engine, spec corpus, and operator docs sit under `v2/` while `v1/` is frozen. Path prefixes and `*:v2` scripts encode a planning label the repo no longer uses; a partial move breaks typecheck until imports, tooling, and CI scope align.

## Decisions

- Move `v2/src` → `src`, `v2/spec` → `spec`, and `v2/docs` → `docs` in one commit — rules out landing `src/` while `package.json` still points at `v2/src/cli.ts`.
- Fold `v2/tsconfig.json` into the root engine `tsconfig` project (`tsc -p` target) with `include` covering `src/**` — rules out retaining any tracked file under `v2/`.
- Rename `test:v2` → `test:agent` and `test:integration:v2` → `test:integration` — rules out `test:engine` (slice mode is `agent`) and bare `test` (aggregate collision).
- Rename `coverage:v2` → `coverage:src` and keep `coverage:shared` pointed at `src/shared/` — rules out leaving a `*:v2` coverage script.
- Rename `scripts/run-v2-tests.ts` → `scripts/run-slice-tests.ts` and exported discovery helpers to neutral names (`walkSliceTestFiles`, `sliceTests`) — rules out a `v2` filename on the runner entrypoint.
- `classifyChangedPaths` treats `src/**` and `test/**` like today's `v2/**` and emits `["test:agent", "test:integration"]` — rules out keeping `v2/` prefixes in CI scope.
- `NO_TEST_IMPACT_PATTERNS` use `docs/**` and `spec/**` instead of `v2/docs/**` and `v2/spec/**`.
- Jarvis-repo fixtures and literals that pin self-project `plan.targetDir` or scaffold paths under `v2/spec` move to `spec` — rules out implementing edits to `~/.jarvis/config.json` (operator-owned); do not re-prove unchanged `DEFAULT_PLAN_TARGET_DIR` (`spec` on main).
- Mechanical `v2/src`, `v2/spec`, and `v2/docs` path literals in moved `docs/**` and `spec/reliability-*.md` are 00-owned; editorial operator narrative stays in 01.
- `v1/**` and `v1-behaviors.md` filename stay unchanged; do not edit frozen `v1/` sources for path alignment.

## Tasks

- [ ] `git mv` the three trees; remove the empty `v2/` directory.
- [ ] Update `bin/jarvis`, `package.json` (`module`, `start`, `typecheck`, `coverage*`, test scripts), and root `tsconfig.json` (or equivalent `-p` project).
- [ ] Rewrite imports and string path literals across `src/`, `scripts/`, `test/`, `prompts/`, and `.github/` that referenced `v2/`.
- [ ] Update `scripts/guard-*.ts` and their tests, `scripts/ci-test-scope.ts`, `scripts/run-tests.ts`, `scripts/run-slice-tests.ts`, `scripts/reflow-markdown.ts`, `scripts/ready.test.ts` (`JARVIS_READY_TEST_SCOPE` and `bun run test:agent` expectations), and other root scripts that embed `v2/` paths or retired slice names.
- [ ] Update `src/shared/prompts/implement-prompts.test.ts` (and prompt modules) for renamed slice scripts; leave `AGENTS.md` / `CLAUDE.md` layout prose to subspec 01.
- [ ] Update `.markdownlint-cli2.jsonc` globs and `.github/workflows/ci.yml` scoped test steps (drop retired `test:shared` / `test:integration:shared` steps; wire renamed slice scripts).
- [ ] Update harness prompt and guidance modules under `src/shared/prompts/` and `src/shared/spec-guidance-path.ts` for the `docs/` layout.
- [ ] Retarget jarvis self-repo tests that used `v2/spec` scaffold and `plan.targetDir` fixtures (notably `src/commands/init.test.ts`).
- [ ] Mechanically rewrite live-engine `v2/` path prefixes in moved `docs/**` and `spec/reliability-*.md`; add or extend a guard test that fails while those literals remain.

## Acceptance criteria

- [ ] `git ls-files 'v2/**'` is empty (no tracked path under `v2/`).
- [ ] `test/test-slices.test.ts` case `test:v2 and test:integration:v2 enumerate disjoint v2 test file sets` (renamed to match neutral slice wording) expects `package.json` scripts `test:agent` and `test:integration` wired to `scripts/run-slice-tests.ts` and disjoint agent/integration rosters; fails against pre-fix `package.json` / `scripts/run-v2-tests.ts` (reachable via today's `test:v2` keys).
- [ ] `test/test-slices.test.ts` pins no `package.json` script name containing `:v2`; fails against pre-fix `package.json` (`test:v2`, `test:integration:v2`, `coverage:v2`).
- [ ] `scripts/ci-test-scope.test.ts` case for a change under `src/` expects `resolveCiTestScope` to equal `["test:agent", "test:integration"]` only; fails against pre-fix `scripts/ci-test-scope.ts` (reachable via today's `v2/src` prefix and `test:v2` emission).
- [ ] `scripts/ci-test-scope.test.ts` doc-only cases use `docs/**` and `spec/**` changed paths with empty scope; fails against pre-fix patterns `v2/docs/` and `v2/spec/` in `NO_TEST_IMPACT_PATTERNS` (reachable via today's `v2/docs/architecture.md` / `v2/spec/some-spec/index.md` cases).
- [ ] `.github/workflows/ci.yml` contains no `test:shared` or `test:integration:shared` scoped steps; fails against pre-fix workflow (reachable via today's `contains(steps.scope.outputs.scripts, 'test:shared')` steps).
- [ ] `scripts/ready.test.ts` fast-tier fixture uses `JARVIS_READY_TEST_SCOPE` / `bun run test:agent` (not `test:v2`); fails against pre-fix `scripts/ready.test.ts` (reachable via today's `JARVIS_READY_TEST_SCOPE = "test:v2"`).
- [ ] `src/commands/init.test.ts` scaffold and `--target-dir` fixtures resolve under `spec/` (not `v2/spec`); fails against pre-fix `init.test.ts` (reachable via today's `v2/spec/seeds/.gitkeep` assertions).
- [ ] `src/commands/init.test.ts` stays green after fixture retargeting.
- [ ] Committed `docs/**` and `spec/reliability-*.md` contain no `v2/src`, `v2/spec`, or `v2/docs` live-engine path literals; fails against pre-fix content after tree move before mechanical sweep (reachable via today's `v2/docs/**` and `v2/spec/reliability-*.md` links).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:agent` and `bun run test:integration` pass.

## Documentation updates

- Mechanical path rewrites inside moved `docs/**` and `spec/reliability-*.md` belong in this subspec; editorial updates live in subspec 01.
