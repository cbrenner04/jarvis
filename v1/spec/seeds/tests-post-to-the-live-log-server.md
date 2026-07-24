# v1 tests POST to the operator's live log-server on 4310

## Problem

`v1/test/plan-agent-override.test.ts` calls `planCommand({...})` without injecting `logClient`
(the file never mentions `logClient`). `planCommand` only wires the field when a caller supplies it;
when it is absent, `enterMode` falls through to
`createLogClient(cfg.logServerUrl ?? "http://127.0.0.1:4310/logs")` — a **real** HTTP client
(`v1/src/mode-entry.ts` / `shared-entry.ts:89,145`, `v1/src/logging.ts:15`). Plan mode's intent-split
phase then fires `onOutboundPrompt → logOutboundPrompt` (`v1/src/modes/plan/run.ts:788,904,1185,1474`),
which `fetch()`-POSTs the full "Plan Mode - Intent Split Phase" prompt to that URL. The operator's
log-server is always up on `127.0.0.1:4310`, so under `bun run ready` the test silently writes real
log lines into the operator's live server on every run.

`plan.ts:16` documents the field as *"Override the log client (for tests)"* — the seam exists and
this test just doesn't use it, unlike the plan/run tests that inject
`{ assertReachable: async () => {}, send: async () => {} }`.

Observed 2026-07-24: the operator saw the intent-split prompt appear on their log-server on repeat
while running `bun run ready` (the ready gate runs the full v1 suite; a repaired/re-run gate replays
it). Two aggravations, both real: (1) the write is a live network round-trip to the operator's
server, so a slow or wedged log-server adds latency to the test run; (2) it pollutes the operator's
log stream with test traffic that looks like a real run.

## Decisions

- The bug is missing test isolation, not the production default: production **must** keep the real
  client. Fix by injecting a no-op `logClient` in the offending test(s). Rules out changing the
  production `createLogClient` default, which would break real harness logging.
- Add a standing guard so this cannot regress silently: under test, `createLogClient` (or the
  `enterMode` seam) must refuse to construct a real client against the live log-server URL — fail
  loud, or hand back a no-op — keyed on a test-environment signal, not on ad-hoc per-file discipline.
  Rules out fixing only the one file and leaving the next un-injected test to leak again.
- Audit every v1 test that drives a command through `enterMode` (intent/plan/run) for a missing
  `logClient`; inject the no-op fake wherever absent. Rules out assuming `plan-agent-override` is the
  only offender.
- Out of scope: v2. v2 has no log-server code and does not import v1, so v2 runs cannot post to 4310
  (verified). This is a v1-test-only leak surfaced through `bun run ready`.

## Acceptance criteria

- [ ] A guard (static or a test-environment runtime check) makes a v1 test that reaches
      `createLogClient` against the default `127.0.0.1:4310` URL fail loudly or receive a no-op
      client; inverting it (restoring a real client under test) fails the guard.
- [ ] `plan-agent-override.test.ts` — and any other command-path v1 test found without an injected
      `logClient` — injects the no-op fake; a check confirms none of them constructs a real client.
- [ ] With the operator log-server up, running the v1 suite posts **zero** requests to
      `127.0.0.1:4310` (asserted by a fetch interceptor or an equivalent probe over the suite).
- [ ] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v1/docs/operator-runbook.md` § Log server — note that v1 command-path tests must inject a no-op
  `logClient`; the guard enforces it.

## Prerequisites

- `enterMode` / `createLogClient` construct a real HTTP client against `logServerUrl` when no
  `logClient` is injected (current behavior).
