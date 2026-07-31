---
name: propagate-plan-draft-normalizer-reason
---

# Plan draft normalizer rejection propagates its message through contract miss

## Problem

`executePlanDraftWrite` wraps `normalizePlanDraftSpecDir` in `try { … } catch { return false }`
(`v2/src/execution/write.ts`). Named normalizer errors (multi-surface acceptance bullets,
missing index links, cross-boundary decisions) are discarded; the operator sees
`contract_miss` / `failedContractId: "artifact.exists"` with static reason `plan.draft.shape`.

## Decisions

- `validatePlanDraft` captures the normalizer throw message and surfaces it as the dynamic
  `artifact.exists` contract `failureReason` — rules out catch-and-discard returning bare false.
- Missing-shape cases (`index.md` absent, zero subspecs) keep `plan.draft.shape` and do not claim a
  normalizer error — rules out conflating structural absence with normalization policy failures.
- `contract_miss_detail` carries the same diagnostic text the contract settled on — rules out logging
  only agent stdout while the actionable message lives solely in a swallowed throw.
- Harness-appended blocker / retry context uses the propagated `failureReason`, not a generic shape
  slug — rules out leaving the next plan attempt blind to the deterministic rejection.
- Verdict stays `contract_miss`; only the diagnostic changes — rules out admitting a malformed spec
  tree.
- Not in scope: whether a criterion naming two test files should be rejected as multi-surface; that
  is normalizer policy, tracked separately.
- Deferred to first consumer: whether `contract_miss_detail` reuses `responseText` or adds a
  dedicated field — pin when the write-loop emission lands.

## Acceptance criteria

- [ ] A staged plan draft whose subspec has a multi-surface acceptance bullet settles `contract_miss`
      whose `failureReason` contains the normalizer message, including the offending subspec filename
      and bullet text; a regression test in `write.test.ts` fails against the pre-fix code.
- [ ] A staged plan draft whose `index.md` omits a link to a present subspec settles with the
      normalizer index-link message in `failureReason`; a regression test in `write.test.ts` fails
      against the pre-fix code.
- [ ] A stage directory with no `index.md` settles `contract_miss` with `plan.draft.shape` and does
      not claim a normalizer error; a regression test in `write.test.ts` fails against the pre-fix
      code.
- [ ] `write-loop.test.ts` drives a plan-draft normalizer `contract_miss` and asserts
      `contract_miss_detail` carries the same message as `failureReason`; it fails against the
      pre-fix code.
- [ ] Inverting the guard that propagates the normalizer message turns the first two tests RED.

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft shape `contract_miss` carries the normalizer message in
  `failureReason` and `contract_miss_detail`, distinct from bare missing-tree `plan.draft.shape`.
- `v2/docs/v1-behaviors.md` — record v2 plan-draft normalizer rejection diagnostics.

## Prerequisites

