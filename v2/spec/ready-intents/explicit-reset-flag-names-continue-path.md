---
name: explicit-reset-flag-names-continue-path
---

# Explicit reset flag on implement re-dispatch; unlanded-commits refusal names the continue path

Surface: CLI admission for `jarvis run workflow implement` (`v2/src/commands/workflow.ts`) plus the unlanded-commits refusal text.

## Prerequisites

- Incomplete re-dispatch of a clean, unowned, base-descended lane with commits ahead of base continues on its worktree instead of resetting.

## Decisions

- Reset of a continuable lane happens only on an explicit flag, and still passes every existing reset gate; committed work is never silently discarded.
- The unlanded-commits refusal names the continue path first, before hand-finish and `--abandon`.

## Acceptance criteria

- [ ] A test asserts the explicit reset flag still refuses on unlanded commits, and that the refusal text names the continue path before hand-finish and `--abandon`; it fails against the pre-fix CLI, which has no such flag.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — continue vs reset, reset flag.
- `v2/docs/v1-behaviors.md` — explicit reset flag.
