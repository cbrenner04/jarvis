---
name: implement-can-run-integration-slice-tests
---

# An implement lane can run the integration-slice tests its spec changes

## Problem

Files named `*.sandbox-unrunnable.test.ts` (`scripts/test-slice.ts:4`) need real Unix sockets and processes. The claude implement agent runs sandboxed: socket binds under `tmpdir()` fail `EPERM`, and it refuses to disable the sandbox. A spec whose work *is* those files (a speed-up, a fix) asks the agent to run them, so the agent either blocks or ticks criteria it could not have measured. The harness's own finalization gate runs outside the agent sandbox, so the gap is only in the write step.

## Evidence

2026-09-17, lane `real-spawn-daemon-test-waits` (spec `20260916T215526Z-real-spawn-daemon-test-waits`, PR #3956): subspecs 00–02 ticked "`bun test <file>` runs faster than the merge base" for three `*.sandbox-unrunnable.test.ts` files the agent could not run; subspec 03 settled `agent_blocked` with a `## Blocker` stating socket binds return `EPERM` and `dangerouslyDisableSandbox` is refused, asking an operator to measure. Hand-finished: measured 25.30s → 19.57s; one subspec's "faster" tick was false (flat).

## Decisions

- The write step gives the agent a supported way to run named integration-slice test files outside its sandbox — a harness-executed command whose output returns to the agent — rather than asking the agent to escape its sandbox. Rules out disabling the agent sandbox.
- The implement prompt names that command when the active subspec references a `*.sandbox-unrunnable.test.ts` path.
- Scope is criteria that require a *measurement* of such a file (timing, count), which `prompts/implement/rules.md` (#3867) does not cover: that rule lets the agent tick a criterion naming only harness-run suites once in-sandbox checks pass, which is right for pass/fail and wrong for a number the agent never observed. A measurement criterion ticked without a recorded harness execution is unverified at the completion boundary. Rules out ticks the agent could not have earned without contradicting #3867.
- Scope is claude first (the only rung with the observed sandbox); other adapters follow [[agent-confinement-is-per-vendor-and-unexpressed]].

## Acceptance criteria

- [ ] A write-step test asserts an agent request to run a `*.sandbox-unrunnable.test.ts` file through the harness command executes it outside the agent sandbox and returns its output; it fails against the current write step.
- [ ] A prompt-render test asserts the implement prompt names the command when the active subspec references such a file, and omits it otherwise.
- [ ] A completion-boundary test asserts a ticked criterion naming such a file with no recorded harness run of it is refused as unverified.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the integration-slice test command.
- `v2/docs/operator-runbook.md` — note under Coding agents in sandbox.
