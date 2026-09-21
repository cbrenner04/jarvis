---
name: branch-resume-refusal-names-blocking-row
---

# A `branch_not_resumable` refusal names the blocking row's stage id and status

## Problem

The CLI prints only a bare `reason` for a refused branch-scoped resume. The operator must read `pipeline list --json` to learn which row refused and what status it holds.

## Decisions

- The refusal detail carries the blocking row's stage id alongside its status, and the CLI renders both.
- Refusals with no identifiable blocking row still render a readable message.

## Acceptance criteria

- [ ] A test proves the `branch_not_resumable` refusal names the blocking stage id and status; it fails against the pre-fix bare-reason output.
- [ ] A CLI test proves the rendered refusal text includes the stage id and status without requiring `--json`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the refusal message shape operators now see.

## Prerequisites

- Branch resume admission distinguishes provisional from terminal `skipped` successors when deciding admissibility.
