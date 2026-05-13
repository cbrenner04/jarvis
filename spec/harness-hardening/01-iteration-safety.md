# 01 — Iteration safety (SIGINT, timeouts)

## Problem

Two failure modes can leak agent processes or hang the loop:

1. SIGINT handler in `src/modes/patch/run.ts` calls `process.exit(130)` without
   killing the spawned agent child. The child (`claude`, `codex`, `cursor`,
   `opencode`) keeps running, may keep editing files in the worktree, and may
   even push. The harness has exited; the agent has not.
2. There is no per-iteration timeout. A hung agent (network stall, prompt
   loop) hangs `jarvis run` forever. The only governor is `maxIterations`,
   which only fires between iterations.

## Behavior

- `runAgent` in `src/agents/spawn.ts` accepts an `AbortSignal`. When the
  signal aborts mid-run, the spawn helper sends `SIGTERM` to the child,
  waits a short grace period (2s), then `SIGKILL`. The agent result becomes
  `{ kind: "error", exitCode: -1, stderr: "aborted: <reason>" }`.
- `runCommand` constructs an `AbortController` for each iteration. SIGINT
  aborts the current iteration's controller, awaits the agent's settled
  result, then exits 130.
- `runCommand` accepts an optional per-iteration timeout (config:
  `iterationTimeoutMs`, default `30 * 60_000` = 30 minutes). When the
  iteration exceeds it, the controller aborts with reason
  `"iteration-timeout"`. The iteration result is treated as a generic error
  (`kind: "error"`); the run exits with a new exit code `8`
  ("iteration timeout"). The session log records the timeout explicitly.
- `runCommand` also accepts an optional global run timeout (config:
  `runTimeoutMs`, default unset). When unset, no global timeout applies.
  When set, exceeding it aborts the in-flight iteration and exits 8.
- Config validation accepts both keys as optional positive integers and
  rejects zero / negative / non-integer values.
- SIGINT during the seconds-long agent body-gen / PR / push phases also
  abort cleanly. Replace each long-running `execFileSync` call in those
  paths with a child-process spawn that respects the abort signal, or
  document why a given call is short enough not to need it.

## Tasks

- [ ] Plumb `AbortSignal` through `AgentRunOptions` and `spawn.ts`.
- [ ] Wire SIGINT in `runCommand` to abort and await, not exit.
- [ ] Add `iterationTimeoutMs` (and optional `runTimeoutMs`) to `Config`,
      validate, and apply via `setTimeout` + `abort()`.
- [ ] Add exit code `8` to `docs/run-loop.md`.
- [ ] Tests: SIGINT terminates the child (mock agent that records signals);
      per-iteration timeout fires; abort during agent body-gen does not
      leak the child.

## Acceptance criteria

- [ ] A simulated long-running agent receives SIGTERM (then SIGKILL after
      the grace period) when SIGINT is delivered to `jarvis run`.
- [ ] A simulated agent that runs longer than `iterationTimeoutMs` causes
      `runCommand` to return exit code `8` and the child process exits.
- [ ] Config rejects non-positive-integer values for `iterationTimeoutMs`
      and `runTimeoutMs`.
- [ ] `docs/run-loop.md` documents exit code `8`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `docs/run-loop.md`: exit code `8`; describe `iterationTimeoutMs` and
  `runTimeoutMs` config keys.
- `docs/config.md`: list the new config keys with their defaults.
