---
name: tui-surfaces-resume-refusal
---

# TUI surfaces a run's resume refusal reason

## Problem

A refused resume shows no change in the TUI.

## Decisions

- The TUI needs-attention / run-detail region renders the refused-resume blocking state and verbatim reason from the run projection.

## Acceptance criteria

- [ ] For a run with a recorded structural resume refusal, the TUI run-detail / needs-attention region shows the refusal reason (region-local assertion); fails against the pre-fix render.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the TUI shows resume refusals.

## Prerequisites

- The daemon records a structural resume refusal (verbatim reason) on the run when `run resume` is refused by an admission gate.
- `run list` / `run wait` project a recorded structural resume refusal as a named blocking state with its reason.
