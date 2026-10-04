# Plan-draft normalizer message on contract miss

## Problem

`executePlanDraftWrite` wraps `normalizePlanDraftSpecDir` in `try { … } catch { return false }`
(`v2/src/execution/write.ts`). Named normalizer errors (multi-surface acceptance bullets,
missing index links, cross-boundary decisions) are discarded; the operator sees
`contract_miss` / `failedContractId: "artifact.exists"` with static `plan.draft.shape`.

## Decisions

- `validatePlanDraft` returns `{ ok: boolean; reason?: string }`, capturing normalizer throw
  messages and `plan.draft.shape` for missing-tree cases — rules out catch-and-discard returning
  bare `false`.
- `artifact.exists` is one composed check (not two structured values `||`’d): evaluate staging
  (`expectedArtifactPath`, `.jarvis-plan-stage`) then durable (`specPath`); pass if either `.ok`;
  when both fail, staging `reason` wins; when staging fails normalization but durable would pass,
  contract still fails with the staging normalizer `reason` — rules out truthy-object false-pass
  or silent durable fallback.
- After `complete`, durable→staging promotion keeps a boolean success predicate (`.ok` or helper),
  separate from contract `failureReason` propagation — rules out breaking promotion when the
  return shape changes.
- `validatePlanDraftShape` runs before normalization; normalization runs only when shape is valid
  (`index.md` present, at least one `NN-*.md` subspec) — rules out normalizer wording on
  zero-subspec or missing-index trees.
- Missing-shape cases (`index.md` absent, zero `NN-*.md` subspecs) settle `plan.draft.shape` and
  do not claim a normalizer error — rules out conflating structural absence with normalization
  policy failures.
- Verdict stays `contract_miss`; only `failureReason` changes for normalizer rejections —
  rules out admitting a malformed spec tree.
- Not in scope: whether a criterion naming two test files should be rejected as multi-surface;
  that is normalizer policy, tracked separately.

## Task checklist

- Rework `validatePlanDraft` in `write.ts` to return structured outcomes; expose a boolean
  predicate for the promotion path.
- Replace `artifact.exists` `||` with one composed check using subspec 00’s structured return.
- Add `write.test.ts` regressions for normalizer rejection and missing-shape cases.

## Acceptance criteria

- [x] `write.test.ts` drives plan-draft `contract_miss` with agent output under
      `expectedArtifactPath` (`.jarvis-plan-stage`) on a staged subspec with a multi-surface
      acceptance bullet and asserts `failureReason` contains the normalizer message, including
      the offending subspec filename and bullet text; it fails against the pre-fix code.
- [x] `write.test.ts` drives plan-draft `contract_miss` with agent output under
      `expectedArtifactPath` (`.jarvis-plan-stage`) on a staged tree whose `index.md` omits a link
      to a present subspec and asserts `failureReason` contains the normalizer index-link
      message; it fails against the pre-fix code.
- [x] `write.test.ts` drives plan-draft `contract_miss` on a stage directory with no `index.md`
      and asserts `failureReason` is `plan.draft.shape` without normalizer wording; it fails
      against the pre-fix code.
- [x] `write.test.ts` drives plan-draft `contract_miss` on a stage directory with `index.md` but
      zero `NN-*.md` subspecs and asserts `failureReason` is `plan.draft.shape` without
      normalizer wording; it fails against the pre-fix code.
- [x] Plan-draft normalizer `contract_miss` rows keep `failedContractId` `"artifact.exists"`; a
      regression test in `write.test.ts` fails against the pre-fix code.
- [x] Source-mutating `validatePlanDraft` to return `PLAN_DRAFT_SHAPE_REASON` instead of the
      normalizer throw message turns the first two tests RED; a comment checkpoint at that line
      names the mutation. No production test flag exists for this.

## Documentation updates

None — operator-facing docs (`write-behavior.md`, `v1-behaviors.md`) land with subspec 02; do not
merge subspec 01 without 02 or an explicit docs follow-up.
