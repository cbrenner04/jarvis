# Prompt governance for jarvis1 and v2

This document is the durable prompt-layering contract.

For shipped v1 runtime details and tests, see [v1/docs/prompt-governance.md](../../v1/docs/prompt-governance.md).

## Scope and authority

- `prompts/` is the shared prompt source.
- Runtime lookup is by prompt `id`, not file path.
- First rollout scope: patch body/rules, plan draft/review/refine, and shared global/plan fragments.
- Deferred from rollout: human-facing chooser/confirmation strings plus `plan/name-only.md` and `plan/inline-draft.md`.

## Schema

Each rollout artifact has required frontmatter:

- `id`: stable key
- `behavior`: grouping key (`global`, `patch`, `plan`, or another scoped class)
- `kind`: `step` or `fragment`
- `revision`: per-id rendered-output revision marker

Optional relationship fields:

- `placeholders`: `NAME:string` or `NAME:string!`
- `add`: ordered fragment IDs appended before step body
- `remove`: fragment IDs removed from inherited global/behavior sets

Registry-load failures are hard errors:

- missing required metadata
- duplicate IDs
- unknown relationship target IDs where relationship fields are used
- invalid `kind` value

## Rendering contract

Rendering a step is metadata-driven by step `id`:

1. collect `kind: fragment` with `behavior: global`
2. collect `kind: fragment` with `behavior` matching the step behavior
3. apply step `remove`, then step `add`
4. append the step body

Rules:

- Assembly order is deterministic: `global -> behavior -> step`.
- Callers pass step `id` + placeholder values, not explicit fragment lists.
- Placeholder substitution is non-recursive.
- Delimiter policy for injected user data is runtime-enforced.
- Validation split is preserved: registry-load vs render-time failures.

Rollout layering inventory:

- Patch: `global.documentation -> global.naming -> global.terse -> patch.prompt.body`
- Plan: `global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer -> plan.prompt.*`
- `patch.rules` remains step-owned injected body content (not always-layered global/behavior text).

## Placeholder and delimiter contract

- Placeholder tokens use `<NAME>` syntax only.
- Placeholder declarations are uppercase and validated at load time.
- Render-time missing/invalid values fail.
- Sentinel delimiters (`<<<...>>>`) bound injected user data zones and are enforced by runtime policy.

## Revision and snapshots

- Bump `revision` only when rendered output bytes for that `id` change.
- Metadata-only relabels that do not change rendered bytes do not require revision bumps.
- Snapshot keys are revision-aware: `<id>@r<revision>...`.
- Wrapper outputs are stored separately from shared rendered bodies.
