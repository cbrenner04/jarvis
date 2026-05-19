# 02 - Wrap bun run ready with a wall-clock deadline

## Problem

`bun run ready` is currently a shell pipeline in `package.json`:

```
bun install --frozen-lockfile && bun run typecheck && bun run test && bun run check
```

When any step hangs (see subspecs 00 and 01 for the observed `bun test`
case), the whole chain hangs with it, and no upstream caller (agent,
shell, CI) sees the failure until something else gives up. Even with the
per-test timeout from subspec 01 and a watchdog from subspec 03, a hang
in `bun install`, `tsc --noEmit`, or `biome check` would still wedge
`ready` indefinitely.

## Scope and decisions

- Replace the `package.json` `ready` shell pipeline with a small Bun
  script at `scripts/ready.ts` that runs the same four steps in order
  and enforces a single wall-clock deadline across the whole chain.
- Default deadline: **10 minutes**.
- Configurable via environment variable: `JARVIS_READY_TIMEOUT_MS`.
  If set and parseable as a positive integer, overrides the default.
  If unset or invalid, the script falls back to the 10 min default and
  prints a one-line warning on invalid input.
- On deadline expiry the script:
  1. Logs `ready: deadline exceeded after Nms; killing child tree`.
  2. SIGTERMs the in-flight child process group, waits up to 5 s for
     it to exit, then SIGKILLs anything still alive.
  3. Exits with a distinct non-zero code (proposal: `124`, matching
     GNU `timeout`).
- The script invokes children using `Bun.spawn` with `detached: true` so
  it can signal the whole process group, mirroring subspec 03's
  approach for the harness watchdog.
- The four steps and their order are unchanged: `bun install
  --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run
  check`. Each step's stdout/stderr is streamed to the script's
  stdout/stderr unchanged so existing log consumers are unaffected.
- The `package.json` `ready` script becomes `bun scripts/ready.ts`.

## Task checklist

- Add `scripts/ready.ts` implementing the chain, deadline, and
  child-tree kill.
- Update `package.json` `scripts.ready` to invoke the new script.
- Add a unit/integration test (`test/ready-script.test.ts` or similar)
  that stubs a hanging child step and asserts the wrapper exits with
  code 124 within `deadline + 1 s` and that no descendant processes
  survive past `deadline + 5 s`.
- Run the full chain end-to-end at least once during impl to confirm
  no regressions in normal operation.

## Acceptance criteria

- [ ] `scripts/ready.ts` exists and runs `bun install
  --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run
  check` in order, streaming each step's output through.
- [ ] `package.json` `scripts.ready` invokes `bun scripts/ready.ts`.
- [ ] On normal completion the script exits with the underlying chain's
  exit code (0 on success, the failed step's non-zero code otherwise).
- [ ] When the wall-clock deadline expires the script exits with code
  `124` within `deadline + 1 s` and no child processes survive past
  `deadline + 5 s`.
- [ ] `JARVIS_READY_TIMEOUT_MS` overrides the default; invalid values
  fall back to the default with a printed warning.
- [ ] A new test reproduces a hanging step and asserts the deadline
  behavior; it fails on the pre-fix code (current shell pipeline) and
  passes on the new wrapper.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.
- [ ] `bun run check` passes.

## Documentation updates

- Update README's Development section (the `bun run ready` paragraph)
  to mention the default 10 min deadline and the
  `JARVIS_READY_TIMEOUT_MS` override.
- Update `AGENTS.md`'s working-rules section that mentions `bun run
  ready` if needed to note the deadline behavior.
