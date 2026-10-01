# Suffixed plan.draft.shape reasons and compose fallback

## Problem

`validatePlanDraftShapeAtRoot` and `resolvePlanDraftStagingRoot` (`v2/src/execution/write.ts`) settle four distinct shape failures under bare `plan.draft.shape`, so `jarvis run list`/`wait` and pipeline `failureDetail` cannot distinguish missing dir, missing `index.md`, zero subspecs, or ambiguous nested roots. `composePlanDraftArtifactCheck` keys durable fallback only on exact bare `plan.draft.shape`, so suffixed reasons would skip fallback once emitted.

## Decision ledger

- `validatePlanDraftShapeAtRoot` returns `plan.draft.shape:missing-dir`, `:no-index`, and `:no-subspecs` for its three structural cases; rules out keeping bare `plan.draft.shape` for those sites.
- `resolvePlanDraftStagingRoot` returns `plan.draft.shape:nested-roots=<n>` when byte-discovery does not yield exactly one nested spec root (`n` is the candidate count after subspec 01’s discovery rules); rules out reusing `:no-index` or `:no-subspecs` for ambiguous-or-zero nested layout.
- When `stagingDir` is missing, `resolvePlanDraftStagingRoot` returns `:missing-dir` without scanning nested candidates; rules out durable fallback on a non-existent stage tree.
- When top-level `validatePlanDraftShapeAtRoot` already fails with `:no-index` or `:no-subspecs`, settlement keeps that suffix even if nested candidate count ≠ 1; rules out emitting `:nested-roots=<n>` over a definitive top-level structural miss.
- `composePlanDraftArtifactCheck` treats staging `failureReason` as shape-family when it equals bare `plan.draft.shape` or starts with `plan.draft.shape:`; durable-dir fallback runs for every shape-family staging miss except `plan.draft.shape:missing-dir`, which settles on the staging reason only; rules out exact-match-only fallback and rules out durable fallback when the stage directory itself is absent.
- `isEligibleDraftContractReprompt` (`write-loop.ts`) treats bare `plan.draft.shape` and every `plan.draft.shape:*` as non-reprompt-eligible until intent `plan-draft-shape-contract-reprompt` refines copy; rules out suffixed reasons unlocking draft reprompt via today’s exact `failureReason !== "plan.draft.shape"` guard.
- Operator runbook/`write-behavior.md` reprompt prose stays with intent `plan-draft-shape-operator-docs`; rules out duplicating those docs here.

## Task checklist

- Add a small shape-family predicate in `write.ts` and thread suffixed reasons through `validatePlanDraftShapeAtRoot`, `resolvePlanDraftStagingRoot`, `validatePlanDraft`, and settlement paths that already surface `failureReason`.
- Update `composePlanDraftArtifactCheck` to use the shape-family predicate and skip durable fallback only for `plan.draft.shape:missing-dir`.
- Update `write.test.ts` fixtures that today expect bare `plan.draft.shape` for structural misses and nested-root ambiguity (`plan-draft contract_miss on stage without index.md settles plan.draft.shape`, `plan-draft contract_miss on stage with index but zero subspecs settles plan.draft.shape`, `plan-draft contract_miss rejects ambiguous nested spec/ directories`, `checkStagedPlanDraft accepts nested spec/ staging after resolve-and-flatten` ambiguous branches) to expect the matching suffixed reason; add or extend a fixture for missing staging dir → `:missing-dir` if none exists.
- Add a regression test that staging `:no-index` (or `:no-subspecs`) with a valid durable spec tree still exercises durable fallback and settles the staging suffixed reason when durable cannot repair staging; fails against pre-fix compose logic once suffixed reasons are emitted without the shape-family predicate.
- Extend `isEligibleDraftContractReprompt` with the same shape-family rule as compose (or a shared helper) so suffixed shape `contract_miss` does not reprompt; add or extend `write-loop.test.ts` coverage that fails if only bare `plan.draft.shape` is excluded.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` includes a fixture where the staging directory is absent and settlement carries `plan.draft.shape:missing-dir`, not bare `plan.draft.shape`; fails against the pre-fix bare reason.
- [ ] Same file, test `plan-draft contract_miss on stage without index.md settles plan.draft.shape` (rename if needed) asserts `failureReason` is `plan.draft.shape:no-index` and not bare `plan.draft.shape`; fails against the pre-fix bare reason.
- [ ] Same file, test `plan-draft contract_miss on stage with index but zero subspecs settles plan.draft.shape` (rename if needed) asserts `plan.draft.shape:no-subspecs` and not bare `plan.draft.shape`; fails against the pre-fix bare reason.
- [ ] Same file, `plan-draft contract_miss rejects ambiguous nested spec/ directories` asserts `plan.draft.shape:nested-roots=0` and `plan.draft.shape:nested-roots=2` for the zero- and multi-candidate fixtures respectively, neither bare `plan.draft.shape`; fails against the pre-fix bare reason.
- [ ] Same file, a shape-family staging miss with valid durable bytes still falls back through `composePlanDraftArtifactCheck` and, when durable cannot satisfy staging, settles the staging suffixed `plan.draft.shape:*` reason; `plan.draft.shape:missing-dir` does not consult durable; fails against pre-fix exact-match compose guard.
- [ ] Same file, every assertion the task checklist retargets from bare `plan.draft.shape` to a suffixed reason—including ambiguous branches inside `checkStagedPlanDraft accepts nested spec/ staging after resolve-and-flatten` and `plan-draft contract_miss rejects ambiguous nested spec directories across prefixes` (reachable on main)—expects the matching `plan.draft.shape:*` string, not bare `plan.draft.shape`; fails against the pre-fix bare reason.
- [ ] `write-loop.test.ts` proves shape-family `contract_miss` (e.g. `plan.draft.shape:no-index`) does not enter draft contract reprompt; fails against pre-fix `isEligibleDraftContractReprompt` exact-match guard once subspec 00 emits suffixed reasons without the loop change.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None in this subspec (`v2/docs/v1-behaviors.md` is subspec 02).
