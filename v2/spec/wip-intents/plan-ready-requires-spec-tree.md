# Plan refuses to ready a PR without a valid spec tree

**Scope.** v1 harness work — `v1/**`, docs. Lives in `v2/spec/wip-intents/` for routing.

## Problem

A plan run whose draft phase produces no spec tree — only `intent.md`, no
`index.md`, no subspecs — can still reach `gh pr ready` and be merged. PR #233
did exactly this: it merged carrying only `intent.md`, leaving an orphaned spec
dir that neither `jarvis1 plan <ready-intent>` (name already consumed) nor
`jarvis1 plan --resume <index.md>` (no `index.md`) could pick up. The draft-phase
failure was invisible until merge.

## Desired behavior

Plan must not flip its PR out of draft, and must not treat the plan as complete,
unless the spec tree is well-formed:

- `<spec-dir>/index.md` exists and is non-empty.
- At least one subspec file exists.
- The index's task-list entries resolve to those subspec files.

If the tree is malformed, plan leaves the PR in draft and exits non-zero naming
what is missing, so a draft-phase failure can never auto-ready.

## Decisions

- Gate at the ready transition (`maybeMarkPlanPrReady`), so a partial or failed
  draft is caught before `gh pr ready`, not only at draft time.
- Fail closed. Missing/empty `index.md` or zero subspecs is a hard stop, not a
  warning.

## Documentation updates

- `v1/docs/plan-mode.md`: the spec-tree readiness gate and its non-zero exit.

## Out of scope

- Judging subspec content quality (acceptance-criteria wording, etc.).
- Stopping a human who manually marks a draft ready and merges; the gate governs
  jarvis's own `gh pr ready`.
