---
name: completion-commit-subject-describes-the-change
---

# Completion commit subject describes the change, not a fixed harness string

## Problem

Every v2 completion commit uses the hardcoded subject `jarvis: complete run`
(`v2/src/execution/completion-commit.ts:71`), so `git log` on `main` is a wall of
identical subjects carrying zero signal — `bisect`, `blame`, `--oneline`, and
squash-merge subjects are all degraded. The subject should describe the change.

## Behavior

- Completion commit subject derives from the spec (title/name already in hand at
  commit time via `input.specPath`), not a fixed string.
- `Spec:` and `Jarvis-Agent:` trailers are preserved (attribution/routing that
  `completion-commit.ts` and `pr-body-refresh.ts` depend on).
- The already-committed idempotency check (currently
  `headMessage.startsWith("jarvis: complete run")`,
  `completion-commit.ts:60`) recognizes a prior completion commit via a marker
  that survives a variable subject (e.g. the `Jarvis-Agent:` trailer), so the
  retry-after-failed-publish path still works.
- Spec-title derivation is the authorship source (cheap, deterministic); no extra
  agent invocation.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the v2 completion-commit subject/trailer
  contract once it changes.

## Prerequisites
