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

As shipped, the prompt registry/renderer surface is root-shared in
`shared/prompts/api.ts` and consumed by both engines (`jarvis1` through
`v1/src/prompts/*` re-exports, and v2 directly).

For mixed builders, only stable instruction text relocates in pass one; interpolation, conditional line construction, and control semantics stay in code.

## Placeholder and delimiter contract

- Placeholder tokens use `<NAME>` syntax only.
- Placeholder declarations are uppercase and validated at load time.
- Render-time missing/invalid values fail.
- Sentinel delimiters (`<<<...>>>`) bound injected user data zones and are enforced by runtime policy.

| Bucket | Current surface | Current source location | First-pass ownership call | Relocation unit | Migration timing / notes |
| --- | --- | --- | --- | --- | --- |
| Agent-bound prompt bodies/fragments | Patch prompt body scaffold (`Inspect...`, `Read the spec...`, `Follow these Jarvis rules...`, `Pick the single most important...`) | `v1/src/modes/patch/prompt.ts` | Move to shared prompt source now | Stable instruction text fragments only | First extraction pass is relocation-only. Keep conditional sibling-directory bullet rendering in TS. |
| Agent-bound prompt bodies/fragments | Injected patch rules body | `v1/src/modes/patch/rules.md` | Move to shared prompt source now | Entire markdown file verbatim | Direct artifact move in first extraction pass. |
| Agent-bound prompt bodies/fragments | Plan refine prompt | `v1/src/modes/plan/prompts/refine.md` | Move to shared prompt source now | Entire file verbatim | Keep runtime template rendering in code; move text only. |
| Agent-bound prompt bodies/fragments | Plan name-only prompt | `v1/src/modes/plan/prompts/name-only.md` | Move to shared prompt source now | Entire file verbatim | Same rendering contract as other plan prompts. |
| Agent-bound prompt bodies/fragments | Plan draft prompt | `v1/src/modes/plan/prompts/draft.md` | Move to shared prompt source now | Entire file verbatim | Sentinel-delimited data sections remain literal prompt text. |
| Agent-bound prompt bodies/fragments | Plan review prompt | `v1/src/modes/plan/prompts/review.md` | Move to shared prompt source now | Entire file verbatim | Keep current file rewrite constraints in prompt artifact. |
| Agent-bound prompt bodies/fragments | Write execute prompt | `prompts/write/execute.md` | Move to shared prompt source now | Entire file verbatim | Stable ID `write.execute`; first v2 write-step prompt surface. |
| Agent-bound prompt bodies/fragments | Plan inline-draft prompt template | `v1/src/modes/plan/prompts/inline-draft.md` (loaded by `v1/src/modes/plan/inline-draft.ts`) | Move to shared prompt source now | Entire file verbatim | Keep loader invocation and template slot filling in runtime code. |
| Agent transport wrappers and correlation markers | Codex invocation marker wrapper appended to outbound prompt payload | `v1/src/agents/codex.ts` (`<!-- jarvis-codex-invocation: <uuid> -->`) | Minimized adapter-local prompt surface | Marker string constant + append behavior | Adapter-transport concern; keep local to Codex adapter with snapshot coverage. |
| Human-facing chooser/confirmation text | TTY-only non-index confirmation text (`[s] switch`, `[e] exit`, `Choice [e]`) | `v1/src/modes/patch/run.ts` | Keep in runtime code for now | Prompt line array + response handling as one unit | Operator control-flow chooser, not shared agent prompt artifact in pass one. |
| Human-facing chooser/confirmation text | Project disambiguation chooser text (interactive + non-TTY candidate output) | `v1/src/disambiguation-prompt.ts` | Keep in runtime code for now | `promptForProject` user-facing strings + list rendering | Human routing UX; still inventory-tracked for later unification review. |
| Generated handoff/next-step text | Printed plan next-step / handoff output (draft PR review, resume command, run command guidance) | `v1/src/commands/plan.ts` | Keep in runtime code for now | `buildPlanCompletionMessage` output block | Runtime-generated from repo/spec/PR state; not moved in relocation-only pass. |

## Revision and snapshots

- Bump `revision` only when rendered output bytes for that `id` change.
- Metadata-only relabels that do not change rendered bytes do not require revision bumps.
- Snapshot keys are revision-aware: `<id>@r<revision>...`.
- Wrapper outputs are stored separately from shared rendered bodies.
