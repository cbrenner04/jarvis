# 04 - Refactor v1 mode tests

## Problem

The v1 mode tests under `v1/test/modes/` match `spawn`. Apply the 00 triage to this cluster so
every file is deterministic and sandbox-safe, without changing mode behavior. `reap.test.ts`
is the DI-seam reference and is expected to be `already-deterministic` — confirm, don't rewrite.

Files: `modes/patch/{reap,shrink,subspec}`, `modes/plan/{boundary,git-porcelain,pr,review}`,
`modes/prompt/run`, `modes/review/run` (`v1/test/modes/**/*.test.ts`).

## Decisions

- Apply each file's 00 verdict as in 01; treat `reap.test.ts` as the seam exemplar to match, not a target. Rules out churning the already-stabilized reference test.
- Route git/process interaction through injected seams; do not run real `git` or spawn real processes in agent-runnable files. Rules out sandbox-unrunnable integration tests in the default suite.
- Where plan/patch tests share fixture setup, reuse `v1/test/helpers/plan-fixtures.ts` rather than per-file duplication. Rules out fixture drift across the cluster.

## Task checklist

- [ ] Apply 00 verdicts to each `v1/test/modes/**/*.test.ts` file.
- [ ] Route spawn/git through injected seams; merge/drop redundant cases the triage flagged.
- [ ] Record in `v2/docs/v1-behaviors.md` only a seam that alters an observable default; test-only optional params defaulting to the real impl need no entry.

## Acceptance criteria

- [x] Every `refactor`-verdict file under `v1/test/modes/` no longer spawns a real OS process; `already-deterministic` files (including `reap.test.ts`) are unchanged; `marked-exception` files are renamed `*.sandbox-unrunnable.test.ts` with a justification comment.
- [x] The mode tests stay green (behavior unchanged) under `bun test --parallel`.
- [x] No mode production behavior changes beyond additive, default-preserving DI seams; any seam that alters an observable default is recorded in `v2/docs/v1-behaviors.md` (test-only optional params defaulting to the real impl need no entry).
- [x] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record any DI seam that alters an observable default, or note none added (additive test-only params defaulting to the real impl are not recorded).
