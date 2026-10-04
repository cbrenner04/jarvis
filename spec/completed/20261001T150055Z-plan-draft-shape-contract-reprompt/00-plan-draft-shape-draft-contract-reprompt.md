# Plan-draft shape miss draft contract reprompt

## Problem

`isEligibleDraftContractReprompt` (`write-loop.ts`) excludes every `plan.draft.shape:*` miss via `!isPlanDraftShapeFamilyReason(...)`, so repairable shape failures never get the existing one-shot `draft_contract_reprompt`. Settlement already emits suffixed shape reasons; the loop must allow reprompt for repairable suffixes while bare `plan.draft.shape` and `plan.draft.shape:missing-dir` stay immediate-settlement, and `draft_contract_reprompt.detail` must tell the agent the flat staging layout (`intent.md`, `index.md`, `NN-*.md` at the staging root) while `contract_miss_detail.failureReason` stays the suffixed shape string.

## Decision ledger

- `isEligibleDraftContractReprompt` treats bare `plan.draft.shape`, any shape-validation bare fallback, and `plan.draft.shape:missing-dir` as ineligible among shape-family `artifact.exists` misses; rules out replacing the whole-family guard with “not `:missing-dir`” only.
- `isEligibleDraftContractReprompt` drops the whole-family `isPlanDraftShapeFamilyReason` guard at this site in favor of that explicit ineligible list; rules out keeping `!isPlanDraftShapeFamilyReason(...)` here.
- Repairable suffixed shape misses (`plan.draft.shape:no-index`, `:no-subspecs`, `:nested-roots=<n>`) invert the prerequisite spec’s whole-family no-reprompt expectation; bare and `:missing-dir` stay immediate settlement; rules out treating archived prerequisite acceptance text as still governing suffixed reprompt.
- Repairable shape misses use the same one-shot `draft_contract_reprompt` budget and `write.draft-contract-reprompt` path as normalizer misses; rules out a separate repair arm or prompt.
- `draft_contract_reprompt.detail` for eligible shape misses is operator/agent-facing copy that names flat staging (`intent.md`, `index.md`, at least one `NN-*.md` at the staging root), not byte-for-byte `failureReason`; terminal `contract_miss_detail.failureReason` remains the suffixed shape string; rules out passing only `plan.draft.shape:*` as `CONTRACT_DETAIL` without layout guidance.
- `plan.draft.blocker`, `intent.prompt.split`, unrelated `promptId`s, and non-shape `artifact.exists` misses without a repromptable reason stay immediate-settlement; rules out widening eligibility beyond the plan-draft shape carve-out.
- Operator runbook / `write-behavior.md` reprompt prose stays with ready-intent `plan-draft-shape-operator-docs`; rules out duplicating runbook edits here.

## Task checklist

- Replace the shape-family exclusion in `isEligibleDraftContractReprompt` with an explicit ineligible check for bare `plan.draft.shape`, shape-validation bare fallback (if distinct), and `plan.draft.shape:missing-dir` (reuse `isPlanDraftShapeFamilyReason` or shared constants only where it avoids drift; do not reintroduce whole-family exclusion at this predicate).
- When scheduling `draft_contract_reprompt` for an eligible shape miss, set `detail` to the flat-layout guidance string (include `intent.md`, `index.md`, and `NN-*.md`); keep passing `contractId` `artifact.exists`.
- Update `write-loop-draft-reprompt.test.ts` so `:no-index`, `:no-subspecs`, and `:nested-roots=<n>` are eligible, bare `plan.draft.shape` and `:missing-dir` stay ineligible (extend today’s bare + `:no-index` false cases).
- Update `write-loop.test.ts` `plan-shape, blocker, intent-split, and unrelated-prompt contract misses settle without a repair` (reachable on main) so suffixed shape cases match the new eligibility; add focused loop tests in `write-loop-draft-reprompt.test.ts` (not `write-loop.test.ts`, which is over budget pending its split) for `:no-subspecs` (one reprompt, layout-named detail, second evaluation) and `:missing-dir` (zero reprompt).
- Update the `draft_contract_reprompt` reprompt bullet in `v2/docs/v1-behaviors.md` to list which `plan.draft.shape:*` suffixes get one in-loop repair and that bare `plan.draft.shape` and `:missing-dir` do not.

## Acceptance criteria

- [x] `v2/src/execution/write-loop-draft-reprompt.test.ts` asserts `isEligibleDraftContractReprompt` is true for `plan.draft.shape:no-index`, `:no-subspecs`, and `:nested-roots=<n>` and false for bare `plan.draft.shape` and `:missing-dir`; fails against the pre-fix whole-family exclusion (today’s test expects suffixed `:no-index` ineligible).
- [x] `v2/src/execution/write-loop-draft-reprompt.test.ts` drives a plan-draft `plan.draft.shape:no-subspecs` `artifact.exists` miss, asserts exactly one `draft_contract_reprompt` whose `detail` names flat staging (`intent.md`, `index.md`, `NN-*.md` at the staging root), then a second write-loop iteration or contract re-evaluation after that reprompt (`iterationsConsumed` ≥ 2 or a second mocked agent invocation); fails against the pre-fix whole-family exclusion.
- [x] Same file, a plan-draft `plan.draft.shape:missing-dir` miss asserts zero `draft_contract_reprompt` events; fails if `:missing-dir` is made eligible (constructible via absent `.jarvis-plan-stage` on the pre-fix loop).
- [x] `v2/docs/v1-behaviors.md` records which `plan.draft.shape:*` suffixes receive one in-loop `draft_contract_reprompt` and that bare `plan.draft.shape` and `plan.draft.shape:missing-dir` do not.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — align the plan-draft `draft_contract_reprompt` behavior-change bullet with suffix-level eligibility (including bare ineligible), and shape reprompt detail naming the flat staging layout.
