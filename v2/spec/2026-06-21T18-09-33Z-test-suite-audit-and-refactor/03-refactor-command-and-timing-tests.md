# 03 - Refactor v1 command/integration + timing tests

## Problem

The v1 top-level command/integration tests and the remaining v1 timing-only tests match
process/clock primitives. Apply the 00 triage to this cluster so every file is deterministic
and sandbox-safe, without changing command behavior.

Files (`v1/test/`): `cli`, `gh`, `install-opencode-permissions`, `intent-command`,
`plan-command`, `pr`, `review-feedback-command` (spawn); `ready-script` (`execFile`/`sleep`),
`prompt` (`Date.now`), `worktree-lock` (`new Date(`).

## Decisions

- Apply each file's 00 verdict (`already-deterministic`/`refactor`/`marked-exception`) as in 01. Rules out rewriting cleared files.
- For `Date.now`/`new Date(` smells (`prompt`, `worktree-lock`), inject a fixed clock so timestamp-derived output is deterministic. Rules out asserting against live wall-clock values.
- `ready-script.test.ts` already drives the serial-retry gate via the `runCommandFn` seam; treat its `sleep`/`execFile` matches per the triage verdict rather than assuming a smell. Rules out re-flaking the just-stabilized gate test.

## Task checklist

- [ ] Apply 00 verdicts to each file in this cluster.
- [ ] Inject fixed clocks for `Date.now`/`new Date(` cases; route spawn through the injected seam; merge/drop redundant cases.
- [ ] Record in `v2/docs/v1-behaviors.md` only a seam that alters an observable default; test-only optional params defaulting to the real impl need no entry.

## Acceptance criteria

- [x] Every `refactor`-verdict file in this cluster no longer spawns a real OS process and derives no assertion from live wall-clock time; `already-deterministic` files are unchanged; `marked-exception` files are renamed `*.sandbox-unrunnable.test.ts` with a justification comment.
- [x] These command/integration and timing tests stay green (behavior unchanged) under `bun test --parallel`.
- [x] No command production behavior changes beyond additive, default-preserving DI seams; any seam that alters an observable default is recorded in `v2/docs/v1-behaviors.md` (test-only optional params defaulting to the real impl need no entry).
- [x] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record any DI seam that alters an observable default, or note none added (additive test-only params defaulting to the real impl are not recorded).
