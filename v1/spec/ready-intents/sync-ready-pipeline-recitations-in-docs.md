---
name: sync-ready-pipeline-recitations-in-docs
---

# Step-level ready-pipeline recitations include `lint:md` as the final full-tier step

## Behavior

Narrative docs that enumerate the ready pipeline at step level recite the
current full tier (`check:fix:unsafe → typecheck → test → check → lint:md`)
instead of the stale sequence ending at `check`. A reader trusting the docs
sees Markdown as gated, matching the enforced gate.

Known stale recitations to sync (`run-loop.md` ready-tier table is the source
of truth — already correct, do not edit):
- `v1/docs/plan-mode.md:373` — `…before typecheck → test → check proceeds`
- `v1/docs/worktrees-and-commits.md:116` — `(typecheck → test → check)`
- `v1/docs/workflows.md` (~78, ~190, ~231, ~364) — `install → check:fix → …`
  and `typecheck → test → check` enumerations

Leave genuinely abstracted mentions (`bun run ready` with no step list)
untouched — don't force step detail where a doc deliberately abstracts.

Plan may weigh whether the canonical step list should live in one linked place
to prevent re-drift, vs. minimal mechanical edits per doc.

## Out of scope

- Re-litigating where `lint:md` sits in the tier (settled: last, full tier only).
- Docs that abstract `ready` without enumerating steps.

## Prerequisites

