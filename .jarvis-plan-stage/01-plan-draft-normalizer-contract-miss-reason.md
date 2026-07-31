# Plan-draft normalizer message on contract miss

## Problem

`executePlanDraftWrite` wraps `normalizePlanDraftSpecDir` in `try { … } catch { return false }`
(`v2/src/execution/write.ts`). Named normalizer errors (multi-surface acceptance bullets,
missing index links, cross-boundary decisions) are discarded; the operator sees
`contract_miss` / `failedContractId: "artifact.exists"` with static `plan.draft.shape`.

## Decisions

- `validatePlanDraft` captures the normalizer throw message and surfaces it through the
  `artifact.exists` check’s structured failure — rules out catch-and-discard returning bare
  `false`.
- Missing-shape cases (`index.md` absent, zero `NN-*.md` subspecs) keep `plan.draft.shape` and
  do not claim a normalizer error — rules out conflating structural absence with normalization
  policy failures.
- Structural shape still uses `validatePlanDraftShape` before normalization; normalization runs
  only when `index.md` exists — rules out throwing normalizer errors for an empty stage tree.
- Verdict stays `contract_miss`; only `failureReason` changes for normalizer rejections — rules
  out admitting a malformed spec tree.
- Not in scope: whether a criterion naming two test files should be rejected as multi-surface;
  that is normalizer policy, tracked separately.

## Task checklist

- Rework `validatePlanDraft` in `write.ts` to return structured failure from normalization throws
  and `plan.draft.shape` for missing-tree cases.
- Wire the `artifact.exists` check to use subspec 00’s structured check return.
- Add `write.test.ts` regressions for normalizer rejection and missing-shape cases.

## Acceptance criteria

- [ ] `write.test.ts` drives plan-draft `contract_miss` on a staged subspec with a multi-surface acceptance bullet and asserts `failureReason` contains the normalizer message, including the offending subspec filename and bullet text; it fails against the pre-fix code.
- [ ] `write.test.ts` drives plan-draft `contract_miss` on a staged tree whose `index.md` omits a link to a present subspec and asserts `failureReason` contains the normalizer index-link message; it fails against the pre-fix code.
- [ ] `write.test.ts` drives plan-draft `contract_miss` on a stage directory with no `index.md` and asserts `failureReason` is `plan.draft.shape` without normalizer wording; it fails against the pre-fix code.
- [ ] `write.test.ts` drives plan-draft `contract_miss` on a stage directory with `index.md` but zero `NN-*.md` subspecs and asserts `failureReason` is `plan.draft.shape` without normalizer wording; it fails against the pre-fix code.
- [ ] Inverting the guard that propagates the normalizer throw message through `validatePlanDraft` turns the first two tests RED.

## Documentation updates

None — durable operator docs for loop surfaces land in subspec 02 once
`contract_miss_detail` and harness blockers carry the same text.
