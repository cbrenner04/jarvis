---
name: spawned-cli-tests-inherit-a-five-second-connect-bound
---

# A spawned-CLI test is bounded by the IPC connect timeout, not by its test timeout

## Problem

Tests that spawn a jarvis CLI child which connects to the daemon socket are bounded by `CONNECT_TIMEOUT_MS = 5_000` in `v2/src/ipc/client.ts:11`, a production constant the test cannot see or raise. Under load the connect exceeds that budget and the child fails at exactly 5000 ms. That number reads like a test-timeout problem, and is not one — no test timing in this repo is 5000 ms — so the failure gets misdiagnosed and "fixed" by adjusting timeouts that were never in play.

## Evidence (2026-09-20)

`bunfig.toml` sets `[test] timeout = 30000` repo-wide, and `v2/src/commands/workflow.test.ts` contains no `5000` literal, so a 5000 ms settle cannot come from test timing. The affected tests are the detach test (`workflow.test.ts:1013`, spawning through `spawnWorkflowCliChild` at `:1226`) and `assertAttachedEntryTerminalWait` (`:1288`, spawning at `:1297`); both run a real `v2/src/cli.ts` child against a real socket.

A plan (PR #4105, `workflow-terminal-waits-await-durable-boundary`) was rejected this session for proposing a 30000 ms per-test timeout to escape a 5000 ms default that does not exist — a literal no-op, because 30000 is already the timeout and 5000 is the connect bound.

## Decisions

- Open question, to be settled by the spec: either a spawned-CLI test can raise or inject the connect bound for its child, or `CONNECT_TIMEOUT_MS` itself becomes load-aware (retry/extend on a saturated host) rather than a flat wall. Pick one on evidence; do not pre-decide.
- Whichever is chosen, the failure must name itself: a child that exhausts the connect bound reports the connect timeout and its budget, so it is not mistaken for a test timeout.
- Scope is the connect bound and how spawned-CLI tests are bounded by it. No change to `nextFrame()`'s deliberately unbounded default, and no change to what the affected tests assert.

## Acceptance criteria

- [ ] A test proves a spawned-CLI child whose connect exceeds the default bound fails with a message naming the connect timeout and its budget, distinguishable from a test timeout.
- [ ] The two affected tests in `v2/src/commands/workflow.test.ts` no longer inherit an unadjustable 5000 ms connect bound (by injection or by a load-aware bound, per the decision above), proven by a test that fails against the current flat constant.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-practices.md` — a 5000 ms child failure in a spawned-CLI test is the IPC connect bound, not a test timeout; raising the test timeout cannot fix it.
