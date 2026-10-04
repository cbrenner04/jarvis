# Guard script for Git/GitHub `runAsync` spawn bypass

## Problem

Typed boundaries in `shared/git.ts` and `v2/src/execution/github-operations.ts` do not stop new `runner.runAsync("git", …)` / `runAsync("gh", …)` call sites in `v2/src` production code. A repo-local guard must detect those literals the way other `scripts/guard-*.ts` runners do.

## Decision ledger

- Implement `scripts/guard-git-spawn-bypass.ts` (not a Biome rule or ESLint plugin); rules out duplicating guard-runner conventions (`import.meta.main`, stderr line format, co-located `*.test.ts`).
- Scan only production modules under `v2/src/**` via `isProductionSourceFile` from `scripts/production-files.ts`; exclude `shared/**`, `scripts/**`, and `v1/**`; rules out scanning `shared/git.ts` or widening to root scripts in this guard.
- Match `.runAsync("git"` and `.runAsync('git'` (and the same for `gh`) including optional whitespace after `(`; rules out only banning string templates or dynamic command variables without also catching the literal bypass the intent names.
- Hard-allow exactly `v2/src/execution/github-operations.ts` for `runAsync("gh"` / `runAsync('gh'`; every other production file is forbidden for both `git` and `gh`; rules out a repo-wide `gh` allowlist or allowing `git` spawns outside `shared/git.ts`.
- Per-call escape hatch: `// guard-git-spawn-bypass: <reason>` on the spawn line or the line above (same ergonomics as `guard-unbounded-subprocess:`); rules out file-level blanket exemptions without a line-local rationale.
- Do not wire `package.json` `check` in this subspec; rules out landing a failing `bun run check` while inline spawns remain (owned by subspec 03).

## Task checklist

- Add `scripts/guard-git-spawn-bypass.ts` exporting `findGitSpawnBypassViolations(files)` and `runGitSpawnBypassGuard(cwd)` walking `v2/src` production files.
- Add `scripts/guard-git-spawn-bypass.test.ts` with synthetic `{ file, source }` fixtures (reject/allow/marker/github-operations allowlist) and one repository-walk assertion against a known reachable violation.
- Extend `shared/git.ts` only when a migration subspec needs a missing typed export; defer new argv shapes to the migration subspec that first needs them.

## Acceptance criteria

- [x] `scripts/guard-git-spawn-bypass.test.ts` test `rejects runAsync git literal in production fixture` fails against an empty pre-fix guard (no exported matcher) and passes once the guard flags `runner.runAsync("git", ["status"], cwd)` in a synthetic `v2/src/execution/example.ts` record.
- [x] `scripts/guard-git-spawn-bypass.test.ts` test `allows github-operations gh owner` passes when the only `runAsync("gh"` in `v2/src/execution/github-operations.ts` is allowlisted and fails if the same literal appears in another production path.
- [x] `scripts/guard-git-spawn-bypass.test.ts` test `allows per-call guard-git-spawn-bypass marker` passes with the marker on the line above the spawn and fails without it for the same source.
- [x] `scripts/guard-git-spawn-bypass.test.ts` test `repository walk reports reachable inline git spawn` fails when `runGitSpawnBypassGuard` scans the current tree where `v2/src/execution/write-loop.ts` still contains `realAsyncSubprocessRunner.runAsync("git",`; reachable on the prerequisite base.
- [x] `bun run typecheck` passes.

## Documentation updates

- None (docs land in subspec 03).
