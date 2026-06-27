---
name: harden-intent-no-commit-pr-assertions
---

# Harden intent no-commit PR assertions

## Problem

`intent` no-commit auto-ready coverage asserts stderr does not contain bare `"PR"`, but stderr includes a random temp path. If that path contains `PR`, the test fails despite correct behavior.

## Decisions

- Match PR-specific output phrases, not bare `"PR"`; rules out substring grepping across random paths.
- Keep random temp directories unique; rules out deterministic temp paths that could mask cross-test isolation bugs.
- Audit sibling negative matchers in the same no-commit assertion block for random-path collision risk; rules out fixing only the observed substring while leaving equivalent flakes.

## Prerequisites

## Behavior

No-commit intent runs keep proving they skip branch/commit/push/PR/ready work, and the test no longer fails because random filesystem paths contain incidental substrings.

## Acceptance

- The no-commit auto-ready test fails only when PR-specific no-commit-forbidden output appears, not when the ready-intents path contains incidental `PR`.
- The sibling `warning` and `https://example.com` negative assertions are confirmed or narrowed if they can collide with random path output.
- Targeted tests for `v1/test/intent-command.sandbox-unrunnable.test.ts` pass.

## Documentation updates

- None expected; test-only assertion hardening. If behavior assertions change operator-facing semantics, update the owning durable docs in the same spec.
