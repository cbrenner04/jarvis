# 00 — Run `check:fix` immediately before the ready gate

## Problem

Jarvis treats `bun run ready` as the draft-to-ready gate for both patch-mode and plan-mode PRs. That gate currently runs `install → typecheck → test → check` without first applying Biome's safe write-mode fixes, so the final `check` step can fail on auto-fixable issues that were left in the branch.

The simplest fix is to prepend `check:fix` to the `commands` array in `scripts/ready.ts` so it runs as the first step of every `bun run ready` invocation. Both harness callers (`src/modes/patch/pr.ts:maybeMarkReady` and `src/modes/plan/pr.ts:maybeMarkPlanPrReady`) already invoke `bun run ready` through the same mechanism, so this one change covers both paths without touching any callsites.

## Decisions (locked)

- Add `check:fix` as the first entry in the `commands` array in `scripts/ready.ts`, before `install`, `typecheck`, `test`, and `check`. This keeps the change in one place and covers every current and future caller of `bun run ready`.
- Keep the scope limited to `scripts/ready.ts`. Do not also modify the two harness callsites, add pre-commit hooks, or broaden loop gates.
- `check:fix` is repo-wide within the worktree because `package.json` already defines it as `biome check --write .`. Do not try to scope it to only modified files.
- If `check:fix` exits non-zero, `scripts/ready.ts` already short-circuits on failure via its existing per-command `code !== 0` guard. No special-casing is needed.
- Reuse the existing error-reporting path: `runCommand` writes to `process.stderr` on spawn errors; `runReady` exits with the failed command's exit code. `check:fix` failures will surface through the same path as `typecheck` or `test` failures.

## Tasks

- [ ] In `scripts/ready.ts`, add `{ name: "bun", args: ["run", "check:fix"] }` as the first entry in the `commands` array inside `runReady`, before the existing `install` entry.
- [ ] Confirm the existing timeout and failure logic (`code !== 0` guard, deadline math) applies to the new first command without modification.
- [ ] Add or update tests for `scripts/ready.ts` to verify `check:fix` runs before `bun install` in the command sequence and that a `check:fix` failure exits before any subsequent command runs.

## Acceptance criteria

- [ ] `bun run ready` invokes `bun run check:fix` as the first command, before `bun install`, `bun run typecheck`, `bun run test`, and `bun run check`.
- [ ] When `check:fix` exits non-zero, `scripts/ready.ts` exits with that code without running any subsequent commands.
- [ ] The existing timeout, deadline math, SIGTERM/SIGKILL behavior, and per-command error reporting in `scripts/ready.ts` are unchanged.
- [ ] Both patch-mode (`maybeMarkReady`) and plan-mode (`maybeMarkPlanPrReady`) readiness paths benefit from the fixer automatically because both invoke `bun run ready`.

## Documentation updates

- [ ] Update the operator-facing docs listed in subspec 01 so they describe the readiness sequence as `check:fix → install → typecheck → test → check → gh pr ready`.

## Out of scope

- Modifying `src/modes/patch/pr.ts` or `src/modes/plan/pr.ts` readiness callsites.
- Running `check:fix` before harness-created patch commits.
- Moving `typecheck`, `test`, or `check` earlier than the existing `ready` gate.
- Changing the definition of `check:fix` or `ready` in `package.json`.
- Adding git hooks, CI changes, or non-readiness uses of `check:fix`.
