---
name: retire-checkpoint-resume-replay
---

# Retire checkpoint reprompt replay on daemon resume

Unsplit rationale: Retiring checkpoint replay is one daemon-bound resume behavior.

## Prerequisites

- Plan drafting, review, normalization, and durable guidance no longer require, author, or validate mutation/keystone checkpoint syntax, while the named pre-fix failing-test rule remains.
- Implement completion ignores checkpoint-shaped criteria, exposes no checkpoint verifier or reprompt prompts, and retains diff-derived verification as the sole mutation gate.

## Primary implementation surface

- Daemon

## Problem

- Daemon resume still scans durable logs and reconstructs checkpoint-specific prompt context for an execution path that no longer consumes it.

## Behavior

- Resume reconstruction does not select mutation-directive, guard-checkpoint, or keystone-directive events or restore their prompt payloads.
- Checkpoint-specific replay inputs and the log-tail recovery helper are removed.
- Pause/resume iteration accounting and all non-checkpoint replay contexts remain unchanged.

## Decisions

- Remove replay reconstruction only after implement retirement makes the contexts inert; rules out changing live recovery semantics before the sole consumer disappears.
- Preserve ordinary paused-run budget recovery and unrelated landing or Markdown-lint reprompts; rules out broadening checkpoint cleanup into generic resume behavior.

## Acceptance criteria

- [ ] Daemon resume tests pin that historical checkpoint reprompt events restore no prompt context and do not affect the resumed iteration budget.
- [ ] Existing paused implement, landing-contract, staged-Markdown-lint, invalid-token, and missing-blocker resume tests stay green.
- [ ] Daemon resume exposes no checkpoint-specific replay context to execution.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove checkpoint reprompt pause/resume reconstruction while retaining generic resume contracts.
- `v2/docs/operator-runbook.md` — remove checkpoint directive/keystone repair and resume guidance.
- `v2/docs/v1-behaviors.md` — remove checkpoint replay semantics from the parity baseline.
