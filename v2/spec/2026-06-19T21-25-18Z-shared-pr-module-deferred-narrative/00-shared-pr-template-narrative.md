# Shared PR module with template-default narrative

## Problem

`generatePrDescription`, the `<<<PR_DESCRIPTION_*>>>` sentinel extraction/validation, the spec-context builder with its 40k cap, and the narrative-regenerating PR-body rewrite are duplicated near-verbatim in `v1/src/modes/patch/pr.ts` and `v1/src/modes/plan/pr.ts`. Both default to invoking the narrative agent on every body refresh. The agent call is unnecessary for the common case: most PR bodies want a deterministic summary, not model prose.

## Behavior

Consolidate the duplicated PR-description/body-rewrite logic into one module consumed by both patch and plan modes. The mode-specific header builder and prompt inputs stay mode-local; the generation core, sentinel extraction/validation, narrative assembly, and rewrite flow are shared.

Add a per-mode narrative selector `modes.patch.prNarrative` and `modes.plan.prNarrative` with values `template` | `agent`, defaulting to `template`:

- `template` (default): the narrative section is built deterministically from the spec index (subspec titles) and branch commit subjects — no agent call. It is marked machine-owned (same generated-hash marker as today) so subsequent rewrites refresh it and human edits inside the markers are preserved verbatim.
- `agent`: unchanged current behavior — invoke the narrative agent to author the Description + `Decisions:` block, with the same sentinel extraction, validation, and null-fallback semantics.

`prNarrative` is honored on **both** the draft-PR *creation* path (first subspec completion's `ensureDraftPr` body generator, which today unconditionally calls the agent) and the body-*rewrite* path. Under `template` the narrative agent is never invoked for PR body content anywhere in the run — neither at creation nor at any rewrite.

The deterministic header (index H1) and attribution footer are unchanged in both modes.

Plan mode's body regeneration today gates on the presence of intent content; `template` has no intent input. Under `template`, plan regenerates the narrative from index + commits without depending on intent content (the intent gate applies only to `agent`).

## Decisions

- Default `prNarrative` is `template`. Rules out the current agent-on-every-refresh default.
- Shared module lives under `v1/src` (not top-level `shared/`). Rules out `shared/**`, which may not import `v1/**` (config, ready-gate, spec parsers, agents).
- One shared module replaces both mode duplicates; `prNarrative` stays mode-scoped under `modes.patch`/`modes.plan`. Rules out a third parallel PR implementation and a single global narrative key.
- Mode-local spec-context builders are retained (patch parses via `parsePatchSpec`, plan via `parseIndex`); only the generation/extraction/assembly core is shared. Rules out forcing one parser across both modes.
- Template narrative is marked machine-owned via the existing generated-hash marker. Rules out treating it as human-edited, which would freeze it and never reflect later commits.
- `prNarrative` omitted in config resolves to `template`; any value other than `template`/`agent` is a config error. Rules out silently accepting typos.
- The `template` default is materialized at config load (resolved onto `ModeConfig`), not applied ad hoc at each read site. Existing configs lacking the key keep working unchanged — they resolve to `template`. Rules out scattered read-site fallbacks that drift.
- `prNarrative` governs draft-PR *creation* as well as rewrite; the creation-path body generator selects template vs agent the same way. Rules out the first body being agent-authored under `template` (which would make a whole run's first body non-deterministic).
- Plan `template` regeneration does not gate on intent content; only `agent` keeps the intent-presence gate. Rules out plan-template never refreshing because no intent is present.
- The two `pr-description-prompt.ts` files are **not** merged: their prompt declarations (inputs, step IDs) differ per mode. Only the generation/extraction/assembly core is shared. Rules out forcing one prompt declaration across both modes.
- Template narrative content = subspec titles from the index plus branch commit subjects. Commit subjects come from `base..HEAD` in `git log` order (newest first), via an injectable command seam so the determinism and "regenerated reflecting new commits" criteria are testable. Rules out a hidden, unseamed git dependency. Deferred to first consumer: exact line formatting/labels within the marker block — pin when implementing the renderer, keep it deterministic and stable across rewrites.

## Task checklist

- [ ] Extract shared generation/extraction/assembly core into one `v1/src`-resident PR module.
- [ ] Add `prNarrative: "template" | "agent"` to `ModeConfig`, materialized to `template` at config load, with config validation.
- [ ] Implement the deterministic template narrative (index subspec titles + `base..HEAD` commit subjects via injectable seam), marked machine-owned.
- [ ] Wire patch and plan PR-body creation *and* rewrite through the shared module, selecting template vs agent per `prNarrative`; plan `template` regeneration drops the intent-content gate.
- [ ] Update docs.

## Acceptance criteria

- [x] Across a patch run with `modes.patch.prNarrative` defaulted/`template`, the narrative agent is never invoked for PR body content anywhere — draft creation and every rewrite produce the narrative deterministically from the index and `base..HEAD` commits.
- [x] Across a plan run with `modes.plan.prNarrative` defaulted/`template`, the narrative agent is never invoked for PR body content; plan regenerates the narrative deterministically even though no intent content is present.
- [x] With `prNarrative: "agent"`, the narrative agent is invoked and its sentinel-delimited output drives the narrative, preserving the existing extraction/validation/null-fallback behavior.
- [x] The template narrative is regenerated on a subsequent rewrite reflecting new `base..HEAD` commits (driven through the injectable commit seam) while a human edit inside the narrative markers is preserved verbatim.
- [x] A config with `prNarrative` set to a value other than `template` or `agent` is rejected with a config error.
- [x] Patch and plan no longer carry duplicate copies of the PR-description generation and narrative-assembly logic; both route through the shared module.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR-body narrative section now describes `template` (default) vs `agent` modes and the per-mode `prNarrative` config key.
- `v2/docs/v1-behaviors.md`: record the shared PR module, the `template` default, that the narrative agent runs only under `prNarrative: "agent"`, and that draft-PR *creation* (not just rewrite) now honors `prNarrative` instead of always invoking the agent.
