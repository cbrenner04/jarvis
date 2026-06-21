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
- [ ] Record any new production DI seam in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] Every `refactor`-verdict file in this cluster no longer spawns a real OS process and derives no assertion from live wall-clock time; `already-deterministic` files are unchanged; `marked-exception` files are renamed `*.sandbox-unrunnable.test.ts` with a justification comment.
- [ ] These command/integration and timing tests stay green (behavior unchanged) under `bun test --parallel`.
- [ ] No command production behavior changes beyond additive, default-preserving DI seams; any new seam is recorded in `v2/docs/v1-behaviors.md`.
- [ ] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record any new production DI seam, or note none added.
