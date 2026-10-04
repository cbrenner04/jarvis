# Wire spawn guard into check and document enforcement

## Problem

The spawn-bypass guard must run in the same `bun run check` sequence as other structural guards, and operators need the exception process recorded beside the Git/GitHub ownership sections.

## Decision ledger

- Append `bun run scripts/guard-git-spawn-bypass.ts` to the `check` script in `package.json` after the existing guard chain; rules out a standalone script omitted from pre-commit/ready flows.
- Update the pinned `check` string in `v1/test/ready-script.sandbox-unrunnable.test.ts` when present so drift is caught; rules out silent `package.json`/`ready` mismatch.
- Document the guard in `AGENTS.md` (Git operations bullet) and `v2/docs/v2-architecture.md` § Git operation ownership / GitHub operation ownership; rules out a coding-standards-only mention that omits the architecture contract.
- Exception process for operators: add a marked bypass only with `// guard-git-spawn-bypass: <reason>` and shrink the remaining inline inventory in architecture docs to zero except pinned markers; rules out undocumented file allowlists in the guard source.

## Prerequisites

- Subspec [02](./02-migrate-execution-inline-git-gh-spawns.md) merged (`runGitSpawnBypassGuard` clean on the tree).

## Task checklist

- Wire the guard into `package.json` `check`.
- Pin the updated `check` command in `v1/test/ready-script.sandbox-unrunnable.test.ts` if that test asserts the string.
- Update `AGENTS.md` and `v2/docs/v2-architecture.md` (retire “remaining inline” prose that the guard now enforces; name `scripts/guard-git-spawn-bypass.ts`, scope `v2/src` production, `github-operations.ts` owner, marker exceptions).
- Refresh the inline-site bullet list in `v2/docs/v2-architecture.md` to match the post-migration tree (or state none except marked archive if applicable).

## Acceptance criteria

- [x] `bun run check` runs `scripts/guard-git-spawn-bypass.ts` and exits 0 on the migrated tree; fails if a production `v2/src/execution/example.ts` with `runAsync("git",` is temporarily introduced (reachable via guard test fixture or local edit — verify via `runGitSpawnBypassGuard` non-zero).
- [x] `v1/test/ready-script.sandbox-unrunnable.test.ts` pins the `check` script including `guard-git-spawn-bypass.ts` when that file asserts the check string.
- [x] `AGENTS.md` names the guard, `v2/src` scope, and the `guard-git-spawn-bypass:` exception marker.
- [x] `v2/docs/v2-architecture.md` documents the guard as enforcement for Git/GitHub spawn boundaries and lists no unmarked inline `runAsync("git"`/`gh` sites in `v2/src` production code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `AGENTS.md` — guard preventing Git/GitHub command construction in v2 production code; exception marker process.
- `v2/docs/v2-architecture.md` — guard as part of Git/GitHub operation boundary enforcement; update remaining-inline inventory.
