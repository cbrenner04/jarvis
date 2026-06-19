# Shared PR module with template-default narrative

## Problem

`generatePrDescription`, the `<<<PR_DESCRIPTION_*>>>` sentinel extraction/validation, the spec-context builder with its 40k cap, and the narrative-regenerating PR-body rewrite are duplicated near-verbatim in `v1/src/modes/patch/pr.ts` and `v1/src/modes/plan/pr.ts`. Both default to invoking the narrative agent on every body refresh. The agent call is unnecessary for the common case: most PR bodies want a deterministic summary, not model prose.

## Behavior

Consolidate the duplicated PR-description/body-rewrite logic into one module consumed by both patch and plan modes. The mode-specific header builder and prompt inputs stay mode-local; the generation core, sentinel extraction/validation, narrative assembly, and rewrite flow are shared.

Add a per-mode narrative selector `modes.patch.prNarrative` and `modes.plan.prNarrative` with values `template` | `agent`, defaulting to `template`:

- `template` (default): the narrative section is built deterministically from the spec index (subspec titles) and branch commit subjects — no agent call. It is marked machine-owned (same generated-hash marker as today) so subsequent rewrites refresh it and human edits inside the markers are preserved verbatim.
- `agent`: unchanged current behavior — invoke the narrative agent to author the Description + `Decisions:` block, with the same sentinel extraction, validation, and null-fallback semantics.

The deterministic header (index H1) and attribution footer are unchanged in both modes.

## Decisions

- Default `prNarrative` is `template`. Rules out the current agent-on-every-refresh default.
- Shared module lives under `v1/src` (not top-level `shared/`). Rules out `shared/**`, which may not import `v1/**` (config, ready-gate, spec parsers, agents).
- One shared module replaces both mode duplicates; `prNarrative` stays mode-scoped under `modes.patch`/`modes.plan`. Rules out a third parallel PR implementation and a single global narrative key.
- Mode-local spec-context builders are retained (patch parses via `parsePatchSpec`, plan via `parseIndex`); only the generation/extraction/assembly core is shared. Rules out forcing one parser across both modes.
- Template narrative is marked machine-owned via the existing generated-hash marker. Rules out treating it as human-edited, which would freeze it and never reflect later commits.
- `prNarrative` omitted in config resolves to `template`; any value other than `template`/`agent` is a config error. Rules out silently accepting typos.
- Template narrative content = subspec titles from the index plus branch commit subjects. Deferred to first consumer: exact line formatting/labels within the marker block — pin when implementing the renderer, keep it deterministic and stable across rewrites.

## Task checklist

- [ ] Extract shared generation/extraction/assembly core into one `v1/src`-resident PR module.
- [ ] Add `prNarrative: "template" | "agent"` to `ModeConfig`, default `template`, with config validation.
- [ ] Implement the deterministic template narrative (index subspec titles + commit subjects), marked machine-owned.
- [ ] Wire patch and plan PR-body rewrites through the shared module, selecting template vs agent per `prNarrative`.
- [ ] Update docs.

## Acceptance criteria

- [ ] With `modes.patch.prNarrative` defaulted/`template`, a patch PR body's narrative section is produced deterministically from the index and branch commits with no narrative-agent invocation.
- [ ] With `modes.plan.prNarrative` defaulted/`template`, a plan PR body's narrative section is produced deterministically with no narrative-agent invocation.
- [ ] With `prNarrative: "agent"`, the narrative agent is invoked and its sentinel-delimited output drives the narrative, preserving the existing extraction/validation/null-fallback behavior.
- [ ] The template narrative is regenerated on a subsequent rewrite (reflecting new commits) while a human edit inside the narrative markers is preserved verbatim.
- [ ] A config with `prNarrative` set to a value other than `template` or `agent` is rejected with a config error.
- [ ] Patch and plan no longer carry duplicate copies of the PR-description generation and narrative-assembly logic; both route through the shared module.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR-body narrative section now describes `template` (default) vs `agent` modes and the per-mode `prNarrative` config key.
- `v2/docs/v1-behaviors.md`: record the shared PR module, the `template` default, and that the narrative agent runs only under `prNarrative: "agent"`.
