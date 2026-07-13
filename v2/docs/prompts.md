# Prompt governance for jarvis1 and v2

This document is the durable prompt-layering contract.

For shipped v1 runtime details and tests, see [v1/docs/prompt-governance.md](../../v1/docs/prompt-governance.md).

## Scope and authority

- `prompts/` is the shared prompt source.
- Registration is an explicit seed list, not path scanning: `prompts/registry.txt`
  lists one artifact path per line, relative to `prompts/`. The whole file is the
  manifest, so the registered set is auditable at a glance. Adding an artifact is a
  one-line edit (no code change); frontmatter-less templates (e.g. `plan/name-only.md`,
  `plan/inline-draft.md`) stay off the list and are loaded directly by their call sites.
- Runtime lookup is by prompt `id`, not file path.
- First rollout scope: patch body/rules, plan draft/review/refine/review-actuator, and shared global/plan fragments.
- Deferred from rollout: human-facing chooser/confirmation strings plus `plan/name-only.md` and `plan/inline-draft.md`.

## Schema

Each rollout artifact has required frontmatter:

- `id`: stable key
- `behavior`: grouping key (`global`, `patch`, `plan`, or another scoped class)
- `kind`: `step` or `fragment`
- `revision`: per-id rendered-output revision marker

Optional relationship fields:

- `placeholders`: `NAME:string` or `NAME:string!`
- `order`: integer assembly rank within a behavior layer; lower renders first,
  unranked fragments sort last by `id`
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

- Assembly order is deterministic: `global -> behavior -> step`; within a layer,
  fragments sort by the `order` frontmatter field (unranked last, by `id`).
- Callers pass step `id` + placeholder values, not explicit fragment lists.
- Placeholder substitution is non-recursive.
- Delimiter policy for injected user data is runtime-enforced.
- Validation split is preserved: registry-load vs render-time failures.

Rollout layering inventory:

- Patch: `global.documentation -> global.naming -> global.terse -> patch.prompt.body` (`STEP_RULES:string!`, final block)
- Patch shrink: `global.terse -> patch.prompt.shrink` (`STEP_RULES:string!`, final block; no `patch.rules`)
- Plan: `global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer -> plan.prompt.*`
- Plan draft (v2 write loop): `plan.prompt.draft` steps route through `buildPlanDraftPrompt` with full plan layering, then runtime `## File output` and `## Step completion` suffixes appended outside the registry artifact (same pattern as `intent.prompt.split`); v1 plan mode invokes the builder without those suffixes.
- Write: a write step renders any registered prompt id via a caller-supplied placeholder map (`renderStepPrompt(promptId, placeholders)`); `write.execute` is the default when a step declares no `promptId`, and is the only id whose caller (`executeWrite`) wires `write.principles` (body) into its `<PRINCIPLES>` placeholder (v2-only; no layered global/behavior fragments)
- Patch PR description: `global.documentation -> global.naming -> global.terse -> shared.pr-description -> patch.prompt.pr-description`
- Plan PR description: `global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer -> shared.pr-description -> plan.prompt.pr-description`
- Intent review: `global.documentation -> global.terse -> intent.prompt.review`
- Intent review actuator: `global.documentation -> global.terse -> intent.prompt.review-actuator`
- `patch.rules` remains step-owned injected body content (not always-layered global/behavior text).

As shipped, the prompt surface is root-shared under `shared/prompts/`
(`types.ts`, `registry.ts`, `render.ts`, `assemble.ts`) and consumed by both
engines (`jarvis1` through `v1/src/prompts/*` re-exports, and v2 directly).

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
| Agent-bound prompt bodies/fragments | Plan review critic prompt | `prompts/plan/review-critic.md` | Move to shared prompt source now | Entire file verbatim | Editorial critic role for light plan-review workflow; renders with plan-review layering (`global.documentation -> global.terse -> plan.decisions-ledger -> plan.defer-to-consumer -> step`); placeholders: WORKDIR, NAME, INTENT, CURRENT_SPEC, SPEC_GUIDANCE, REVIEW_PASS_CONTEXT (all required). |
| Agent-bound prompt bodies/fragments | Patch review critic prompt | `prompts/patch/review-critic.md` | Move to shared prompt source now | Entire file verbatim | Read-only light patch review critic (`patch.prompt.review.critic`); renders with standard patch layering (`global.documentation -> global.naming -> global.terse -> step`); placeholders: SPEC_PATH, SPEC_TREE, BRANCH_DIFF, REVIEW_PASS_NUMBER, REVIEW_PASS_CONTEXT (all required). v2 renders via `renderPatchReviewCriticPrompt` in `v2/src/execution/review-debate-render.ts`, reusing the same patch-review context sources as debate roles (`buildSpecTree`, branch diff summary, pass context). |
| Agent-bound prompt bodies/fragments | Write execute prompt | `prompts/write/execute.md` | Move to shared prompt source now | Entire file verbatim | Stable ID `write.execute`; first v2 write-step prompt surface. |
| Agent-bound prompt bodies/fragments | Write restraint principles | `prompts/write/principles.md` | Move to shared prompt source now | Entire file verbatim | Stable ID `write.principles`; v2-only restraint principles injected into every write iteration. |
| Agent-bound prompt bodies/fragments | Write token re-prompt | `prompts/write/token-reprompt.md` | Move to shared prompt source now | Entire file verbatim | Stable ID `write.token-reprompt`; `runStep` (`v2/src/execution/step-runner.ts`) renders it directly (not through `renderStepPrompt`/`executeWrite`) when a step response carries no terminal token, asking for exactly one of `done`/`no-work`/`blocked`/`progress`; placeholder `RESPONSE_TEXT` (required). |
| Agent-bound prompt bodies/fragments | Plan inline-draft prompt template | `v1/src/modes/plan/prompts/inline-draft.md` (loaded by `v1/src/modes/plan/inline-draft.ts`) | Move to shared prompt source now | Entire file verbatim | Keep loader invocation and template slot filling in runtime code. |
| Agent transport wrappers and correlation markers | Codex invocation marker wrapper appended to outbound prompt payload | `v1/src/agents/codex.ts` (`<!-- jarvis-codex-invocation: <uuid> -->`) | Minimized adapter-local prompt surface | Marker string constant + append behavior | Adapter-transport concern; keep local to Codex adapter with snapshot coverage. |
| Human-facing chooser/confirmation text | TTY-only non-index confirmation text (`[s] switch`, `[e] exit`, `Choice [e]`) | `v1/src/modes/patch/run.ts` | Keep in runtime code for now | Prompt line array + response handling as one unit | Operator control-flow chooser, not shared agent prompt artifact in pass one. |
| Agent-bound prompt bodies/fragments | Intent review prompt | `prompts/intent/review.md` | Move to shared prompt source now | Entire file verbatim | Read-only critic artifact; sentinel-delimited staged-intent section. |
| Agent-bound prompt bodies/fragments | Intent review actuator prompt | `prompts/intent/review-actuator.md` | Move to shared prompt source now | Entire file verbatim | Write-boundary actuator artifact; renders unchanged verdict in delimited data slot. |
| Human-facing chooser/confirmation text | Project disambiguation chooser text (interactive + non-TTY candidate output) | `v1/src/disambiguation-prompt.ts` | Keep in runtime code for now | `promptForProject` user-facing strings + list rendering | Human routing UX; still inventory-tracked for later unification review. |
| Generated handoff/next-step text | Printed plan next-step / handoff output (draft PR review, resume command, run command guidance) | `v1/src/commands/plan.ts` | Keep in runtime code for now | `buildPlanCompletionMessage` output block | Runtime-generated from repo/spec/PR state; not moved in relocation-only pass. |

## Revision and snapshots

- Bump `revision` only when rendered output bytes for that `id` change.
- Metadata-only relabels that do not change rendered bytes do not require revision bumps.
- Snapshot keys are revision-aware: `<id>@r<revision>...`.
- Wrapper outputs are stored separately from shared rendered bodies.
