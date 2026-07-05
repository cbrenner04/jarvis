# Bound spawnSync calls with timeout and named failure

## Problem

`scripts/run-v2-tests.ts` calls `spawnSync("bun", ["test", ...], { stdio: "inherit" })`
with no timeout in both the per-file loop and `agent` mode's parallel run. A
stalled `bun test` process blocks the CI job forever instead of failing with a
diagnosable message. Observed hanging CI `Test (v2)` runs on PR #1003 that
never reproduced locally.

## Decisions

- Every `spawnSync` call in this file gets a `timeout` + `killSignal: "SIGKILL"` option, mirroring the existing `GIT_SUBPROCESS_OPTS` pattern (`v1/src/modes/patch/git-subprocess.ts`) — rules out a workflow-level CI job timeout masking the failure site.
- Two separate timeout constants, not one shared value: `PER_FILE_TIMEOUT_MS = 60_000` (1 min) for each per-file-loop invocation, and `AGENT_MODE_TIMEOUT_MS = 300_000` (5 min) for `agent` mode's single `--parallel` invocation across all agent-scoped files — a single file and a whole parallel suite have structurally different expected durations, and a shared bound risks firing on a healthy whole-suite run or being too loose for a single stalled file.
- Timeout-detection logic (`result.signal === "SIGKILL" && result.status === null`) is extracted into an exported function taking a `spawnSync`-result-shaped object, so it's unit-testable without waiting out a real timeout.
- On detected timeout, exit 1 with a message naming the mode and, for the per-file loop, the specific file that was running. Word the message as "timed out or was killed" rather than asserting certainty — the same signal shape can also result from an external OOM kill, and distinguishing the two is out of scope.
- Root-causing the underlying stall is out of scope.
- `scripts/ci-test-scope.ts` and other CI-scoping logic are unaffected.

## Task Checklist

- [ ] Add `PER_FILE_TIMEOUT_MS` and `AGENT_MODE_TIMEOUT_MS` constants and apply `timeout` + `killSignal: "SIGKILL"` to both `spawnSync` call sites.
- [ ] Extract an exported timeout-detection helper (e.g. `isSpawnTimeout(result)`) taking a `spawnSync`-result-shaped input.
- [ ] Use the helper at both call sites to print a named error identifying mode (`agent`/`integration`) and, in the per-file loop, the file, before exiting non-zero.
- [ ] Add a test exercising the timeout-detection helper and the mode/file-naming in the error message using a synthetic result object, without spawning a real long-running subprocess.

## Acceptance criteria

- [x] Both `spawnSync` calls in `scripts/run-v2-tests.ts` (per-file loop and `agent` mode) carry a timeout with `SIGKILL` on expiry, using separate per-file vs. agent-mode timeout values.
- [x] A timed-out `bun test` invocation exits the script non-zero with a message naming the mode and, when in the per-file loop, the file that was running, instead of hanging.
- [x] A test exercises the timeout-detection branch and the mode/file-naming in the error message via a synthetic `spawnSync`-result-shaped input, with no real long-running subprocess.

## Documentation updates

- `v1/docs/operator-runbook.md` — extend the shrink-hang gotcha (or add a sibling note) noting `Test (v2)` hangs are bounded by the same unbounded-`spawnSync`-timeout pattern.
