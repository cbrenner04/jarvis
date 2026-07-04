---
name: patch-mode-scoped-test-guidance
---

# Patch-mode agents run only the test suite(s) matching the active subspec's touched surface(s)

## Problem

Root `AGENTS.md` unconditionally tells implementing agents to "Run `bun run
typecheck` and `bun run test` before ticking the acceptance criteria they
cover." Every patch-mode iteration waits on the full suite even when the
active subspec only touches one surface (`v1/`, `v2/`, `shared/`).

## Scope

- Update the root `AGENTS.md` instruction so agents run only the surface-scoped
  test script(s) matching the files the active subspec changed, using the
  same v1/v2/shared rule as CI:
  - `v1/**` touched → `test:v1`.
  - `v2/**` touched → `test:v2` (and `test:integration:v2` per the CI
    decision).
  - `shared/**` touched → both `test:v1` and `test:v2`.
  - Root tooling touched, or the surface can't be determined → full
    `bun run test`.
- `bun run typecheck` stays full/unscoped.
- Update `v1/docs/operator-runbook.md` and any other agent-facing doc that
  currently tells agents to run the full suite, so guidance is consistent.

## Out of scope

- CI workflow changes (separate intent).
- Local developer workflow.
- Plan mode — must not start running tests during drafting.

## Documentation updates

- Root `AGENTS.md` "Run `bun run typecheck` and `bun run test`" line.
- `v1/docs/operator-runbook.md` (and any other doc instructing agents to run
  the full suite).

## Prerequisites
