---
name: sync-stale-ready-pipeline-recitations-in-docs
---

# Narrative docs still recite the ready pipeline ending at `check` (pre-`lint:md`)

## Problem

`lint:md` was added to the full ready tier this session (now `check:fix:unsafe →
typecheck → test → check → lint:md`), and `v1/docs/run-loop.md` plus
`v2/docs/v1-behaviors.md` were updated. But sibling narrative docs that recite
the pipeline at step level were out of that spec's enumerated scope and now
describe a stale sequence ending at `check`. Example: `v1/docs/plan-mode.md:373`
("…before `typecheck → test → check` proceeds"). The ready-gate review verdict
flagged this as acceptable follow-up, not a defect — this seed is that follow-up.

Left unsynced, the docs drift from the enforced gate, and a reader trusting them
will believe Markdown is not gated when it now is.

## Direction

Sync the step-level ready-pipeline recitations across the doc corpus to include
`lint:md` as the final full-tier step. Options for plan to weigh:

- Audit `v1/docs/*.md` for pipeline recitations and update each that enumerates
  steps, leaving genuinely abstracted mentions (`bun run ready` with no step
  list) untouched — don't force step detail where the doc deliberately abstracts.
- Confirm which docs are in scope (`plan-mode.md` is the known one; sweep the
  rest) and keep the edits minimal/mechanical.
- Consider whether the canonical step list should live in one place that others
  link to, to prevent the next addition from re-drifting.

## Out of scope

- Re-litigating where `lint:md` sits in the tier (settled: last, full tier only).
- Docs that abstract `ready` without enumerating steps.

## References

- `v1/docs/plan-mode.md` (~line 373) — known stale recitation.
- `v1/docs/run-loop.md` ready-tier table — already correct; use as the source of
  truth.
- Shipped 2026-06-24 in the `markdown-lint-ready-gate` spec (PR #501).
