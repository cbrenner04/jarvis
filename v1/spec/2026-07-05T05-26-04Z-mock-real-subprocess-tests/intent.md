---
name: mock-real-subprocess-tests
---

# Mock real git/gh subprocesses in tests

## Problem

~24 `*.sandbox-unrunnable.test.ts` files (v1 + v2) spawn real `git`/`gh`
subprocesses. They pass in isolation but hang or timeout under `bun test
--parallel` on CI and block every jarvis review baseline gate (`bun run
ready`). Chasing the CI-only hang (deterministic, scales with subprocess
timeout) is not worth it — the design is wrong for a scripting harness whose
logic is argv construction and output parsing.

Fanning this into 17 separate ready intents created a bootstrap deadlock:
each intent's review gate runs the full suite before the mocks exist.

## Direction

One implementation run: introduce a mockable subprocess boundary, convert the
bulk of sandbox-unrunnable coverage to mocked subprocess tests, keep a small
justified real-subprocess set, and drop stale operator-runbook gotchas once
the failure modes are gone.

## Decisions

- Mocking is the default; a test keeps real subprocesses only with an inline
  justification per `v2/docs/test-writing.md`.
- Subspecs may extend the boundary to production `git`/`gh` call sites under
  test — not limited to `shared/git.ts` after subspec 00.
- Large suites (`intent-command`, `patch-review`, `patch-pr`, `plan-command`)
  may split into multiple files when a single converted file would be
  unreviewable.
- Target: routine `bun run test` / `bun run ready` completes in low
  single-digit minutes with no real subprocess spawns for the mockable
  majority.

## Out of scope

- Root-causing the specific CI hang (GPG-signing / PATH leakage suspicion).
- Changing jarvis runtime behavior beyond seams required for test mocking.

## Documentation updates

- `v1/docs/operator-runbook.md` — drop/narrow flaky real-subprocess gotchas
  once affected suites are converted (subspec 20).

## Supersedes

- `v2/spec/2026-07-05T04-07-38Z-mock-subprocess-boundary/` (3-subspec plan;
  landed at wrong path, never implemented on `main`)
- `v1/spec/ready-intents/mock-subprocess-*.md` (17 fan-out ready intents)
- Implementation PR #1040 (partial boundary work; do not merge separately)
