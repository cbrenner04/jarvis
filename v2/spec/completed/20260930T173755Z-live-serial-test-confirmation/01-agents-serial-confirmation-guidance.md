# 01 — Agent guidance and guidance pin test

## Problem

`AGENTS.md` (injected as `REPO_GUIDANCE`) still tells implement agents to confirm scoped failures with bare `bun test`, which includes frozen `v1/`. `shared/prompts/implement-prompts.test.ts` pins that wording.

## Decisions

- Replace only the serial-confirmation bullet in `AGENTS.md`; scoped-first `test:*` gates and "only a serially reproducing failure is real" stay — rules out rewriting unrelated working-rules bullets.
- `implement.rules` stays target-repo-neutral; jarvis-specific confirmation stays in `AGENTS.md` only — rules out moving the command into `prompts/implement/rules.md`.
- The pin test asserts the new script name in the same sentence shape as today (`re-run once serially as …`) — rules out dropping automated guidance coverage.

## Tasks

- [x] Update `AGENTS.md` serial-confirmation instruction to `bun run test:confirm:live`, dropping bare `bun test` and its "without `--parallel`, no path/filter args" parenthetical. Edit `AGENTS.md` only (`CLAUDE.md` symlinks to it).
- [x] Update `shared/prompts/implement-prompts.test.ts` test `the migrated jarvis-specific rules live in this repo's injected guidance` to expect `bun run test:confirm:live` instead of bare `bun test`.

## Acceptance criteria

- [x] `shared/prompts/implement-prompts.test.ts` test `the migrated jarvis-specific rules live in this repo's injected guidance` asserts `bun run test:confirm:live` instead of bare `bun test` and fails against the pre-fix guidance.
- [x] `AGENTS.md` no longer tells agents to run bare `bun test` for serial failure confirmation.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes (branch diff includes subspec 00's root tooling).

## Documentation updates

- Deferred to subspec 02 (`v2/docs/prompts.md`, `v2/docs/v1-behaviors.md`).
