# Phase 9 — natural-language workflow router

Thin client: `jarvis "<intent>"` classifies free text and routes to a named
workflow + explicit args, or an existing run (resume). Conservative — clarify
when unsure.

## Scope

- CLI entry when argv is a single non-flag string (or dedicated subcommand —
  spec decides).
- `operator` role wired for classification invocation (`role-resolution.md`).
- Route schema: `{ workflow, args: WorkflowLaunchArgs }` including
  `reviewPasses`, `reviewBehavior` where relevant; `{ resume, runId }`; `{
  clarify, question }`.
- Router aliases expand to canonical args (`implement-quick-review`, etc.) —
  no duplicate preset implementations.
- Project config defaults for review axes when prompt is bare.
- Linguistic hooks documented in scratch doc; tests for clarify vs route paths.

## Decisions

- Router does not spawn daemon logic — calls same launcher as explicit
  `jarvis run workflow`.
- No guessing `reviewBehavior` when passes > 0 and no default — `clarify`.

## Prerequisites

- Workflow launcher + presets: intent, plan, implement with review selection
  (seeds 01–09).
- Named targets exist for every route the classifier can emit.

## Out of scope

- TUI prompt box (may follow).
- Multi-turn conversation memory.

## Reference

- `.scratch/v2-operator-workflows.md` — Phase 9 integration, Review selection
- `v2/spec/v2-meta-index.md` — Phase 9 line item

## Documentation updates

- `v2/docs/v2-architecture.md` — entry contract no longer "explicit only"
- New `v2/docs/nl-router.md` or section in onboarding
