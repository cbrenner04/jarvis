# 03 - Guard against synchronous child-process calls

With every daemon-reachable subprocess awaited, make regression impossible: a static guard fails the normal gate when `v2/**` or `shared/**` code reintroduces a synchronous child process. Lands after subspecs 00 and 02, whose conversions it depends on — until those land, the tree still violates the guard.

## Decisions

- Implement as a repo script (`scripts/`) with a unit test, not a Biome rule; Biome cannot see `Bun.spawnSync` (a global member expression) and cannot express the CLI-only allowlist. Rules out `noRestrictedImports`.
- Wire it into `bun run ready` (a step in `scripts/ready.ts`'s command list) and into the CI lint job; rules out a review-only or test-only check that never fails the gate an agent's run must pass.
- Scope: all of `v2/**` and `shared/**`, excluding `*.test.ts` and `v2/src/testing/**` (test support). Rules out excluding whole source directories, which would hide daemon-reachable code.
- The only allowlisted module is `shared/subprocess.ts`, the single sanctioned home of the synchronous runner, whose consumers are v1 CLI only. Each allowlist entry carries a reason comment; rules out a growable, unexplained ignore list.
- Rejected constructs: `execSync`, `execFileSync`, and `spawnSync` from `node:child_process` (or `child_process`), and `Bun.spawnSync` — reached by static ESM import, `require(...)`, or dynamic `await import(...)`. Rules out a contract that only names static imports and lets `require`/dynamic import through; regex-vs-AST is the implementer's call.
- `v2/**` may not import `SubprocessRunner` or `realSubprocessRunner`, nor the sync-runner-backed `shared/git.ts` helpers (`branchExistsLocal`, `branchExistsOnOrigin`, `getCurrentBranch`, `isWorktreeDirty`, `isGitRepo`), which block internally via their default sync runner parameter and would pass a construct-only check clean. They stay in `shared/` for v1's CLI callers; v2 has async twins. Rules out relocating them out of `shared/` (churns v1 for no benefit) and rules out a guard that misses them.
- Route `isGitRepo` in `shared/git.ts` through the existing `SubprocessRunner` seam so no shared module outside `shared/subprocess.ts` imports `node:child_process` directly; rules out allowlisting `shared/git.ts`, which is daemon-reachable.
- The guard covers child processes only. Small synchronous filesystem reads stay legal, documented as a narrow exception; rules out banning all sync filesystem calls, and rules out leaving the exception unstated.

## Acceptance criteria

- [x] The guard exits non-zero and names file, line, and construct when a synchronous child-process call is added to a non-test `v2/**` or `shared/**` module, for each of the three reach forms (static import, `require`, dynamic `import`).
- [x] The guard exits non-zero when `v2/**` non-test code imports the synchronous `SubprocessRunner` seam or any sync-runner-backed `shared/git.ts` helper.
- [x] The guard does not flag `*.test.ts`, `v2/src/testing/**`, or the allowlisted `shared/subprocess.ts`.
- [x] The guard exits zero on the tree as of this subspec (with 00 and 02 landed).
- [x] The guard runs as a step of `bun run ready` and of CI, so a violating branch fails the gate before the draft PR flips to ready.
- [x] A unit test for the guard covers a violating fixture per reach form, a v2 sync-seam-import fixture, an allowlisted fixture, and a test-file fixture.

## Documentation updates

- `v2/docs/daemon-host.md`: the daemon-never-blocks invariant (no synchronous child process on any daemon-hosted path) and the guard that enforces it.
- `v2/docs/coding-standards.md`: the synchronous-subprocess prohibition, the allowlist policy for CLI-only modules, and the narrow small-synchronous-filesystem-read exception.
