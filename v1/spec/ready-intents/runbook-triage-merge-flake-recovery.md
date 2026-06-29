---
name: runbook-triage-merge-flake-recovery
---

# Runbook steers flaky local ready failures through `triage --merge` when CI is green

## Problem

`v1/docs/operator-runbook.md` flaky parallel-load guidance tells operators to re-run failing tests
in isolation, then finalize manually. Once `triage --merge` can recover when CI is green at HEAD,
that guidance hides the Jarvis-owned merge path and keeps `gh pr merge --admin` as the default
escape hatch.

## Desired behavior

Update flaky parallel-load and manual-finalize recovery sections in `v1/docs/operator-runbook.md`
to steer operators through `jarvis1 triage <target> --merge` when CI is already green for the PR
head but the local ready gate failed on recoverable flakes. Narrow manual admin-merge to cases where
recovery conditions are not met. Keep deterministic local failures on the existing refuse path.

## Decisions

- `v1/docs/operator-runbook.md` is the operator durable home — rules out documenting only in `v2/docs/v1-behaviors.md`.
- Edit flaky parallel-load and merge/finalize recovery sections only — rules out rewriting unrelated triage or cleanup guidance.

## Documentation updates

- `v1/docs/operator-runbook.md` — flake recovery via `triage --merge` when CI green at HEAD; retire admin-merge-first wording for this flake class.

## Prerequisites

- `jarvis1 triage --merge` continues to admin-merge when the local ready gate fails on recoverable flakes but CI checks are green for the worktree HEAD
