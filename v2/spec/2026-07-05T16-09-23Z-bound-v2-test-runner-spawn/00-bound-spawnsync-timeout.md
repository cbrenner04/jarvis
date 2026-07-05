# Bound spawnSync calls with timeout and named failure

## Problem

`scripts/run-v2-tests.ts` calls `spawnSync("bun", ["test", ...], { stdio: "inherit" })`
with no timeout in both the per-file loop and `agent` mode's parallel run. A
stalled `bun test` process blocks the CI job forever instead of failing with a
diagnosable message. Observed hanging CI `Test (v2)` runs on PR #1003 that
never reproduced locally.

## Decisions

- Every `spawnSync` call in this file gets a `timeout` + `killSignal: "SIGKILL"` option, mirroring the existing `GIT_SUBPROCESS_OPTS` pattern (`v1/src/modes/patch/git-subprocess.ts`) — rules out a workflow-level CI job timeout masking the failure site.
- Timeout value: 300_000ms (5 min) per `bun test` invocation — long enough for the full `v2` suite or a single file, short enough to fail well inside CI's job budget.
- On timeout (`result.signal === "SIGKILL"` with `result.status === null`), exit 1 with a message naming the mode and, for the per-file loop, the specific file that was running — rules out a silent/opaque non-zero exit.
- Root-causing the underlying stall is out of scope.
- `scripts/ci-test-scope.ts` and other CI-scoping logic are unaffected.

## Task Checklist

- [ ] Add a shared timeout+kill option (or inline options) to both `spawnSync` call sites in `scripts/run-v2-tests.ts`.
- [ ] Detect the timeout outcome and print a named error identifying mode (`agent`/`integration`) and, in the per-file loop, the file, before exiting non-zero.
- [ ] Add/extend a test covering the timeout-detection and error-naming behavior.

## Acceptance criteria

- [ ] Both `spawnSync` calls in `scripts/run-v2-tests.ts` (per-file loop and `agent` mode) carry a timeout with `SIGKILL` on expiry.
- [ ] A timed-out `bun test` invocation exits the script non-zero with a message naming the mode and, when in the per-file loop, the file that was running, instead of hanging.

## Documentation updates

- `v1/docs/operator-runbook.md` — extend the shrink-hang gotcha (or add a sibling note) noting `Test (v2)` hangs are bounded by the same unbounded-`spawnSync`-timeout pattern.
