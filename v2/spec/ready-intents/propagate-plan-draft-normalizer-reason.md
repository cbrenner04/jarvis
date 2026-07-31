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
- `StepContract.check` may return `{ ok: false; reason: string }`; `evaluateContracts` propagates
  a check-returned `reason` as `failureReason` ahead of static `contract.reason` — rules out a
  boolean-only check that cannot carry the normalizer message to `step-runner`.
- Missing-shape cases (`index.md` absent, zero subspecs) keep `plan.draft.shape` and do not claim a
  normalizer error — rules out conflating structural absence with normalization policy failures.
- `contract_miss_detail` adds optional `failureReason` for the settled contract diagnostic;
  `responseText` stays agent stdout — rules out overloading `responseText` with the contract reason.
- Harness-appended blocker uses the propagated `failureReason`, not a generic shape slug — rules out
  leaving the next plan attempt blind to the deterministic rejection.
- Verdict stays `contract_miss`; only the diagnostic changes — rules out admitting a malformed spec
  tree.
- Not in scope: whether a criterion naming two test files should be rejected as multi-surface; that
  is normalizer policy, tracked separately.

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
- [ ] A stage directory with `index.md` but zero `NN-*.md` subspecs settles `contract_miss` with
      `plan.draft.shape` and does not claim a normalizer error; a regression test in `write.test.ts`
      fails against the pre-fix code.
- [ ] `write-loop.test.ts` drives a plan-draft normalizer `contract_miss` and asserts
      `contract_miss_detail.failureReason` matches `failureReason`; `responseText` remains agent
      stdout; it fails against the pre-fix code.
- [ ] A plan-draft normalizer `contract_miss` harness-appends a `## Blocker` whose body contains the
      normalizer message; a regression test in `write-loop.test.ts` fails against the pre-fix code.
- [ ] Inverting the guard that propagates the normalizer message turns the first two tests RED.

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft shape `contract_miss` carries the normalizer message in
  `failureReason`, `contract_miss_detail.failureReason`, and the harness-appended blocker; distinct
  from bare missing-tree `plan.draft.shape`; `contract_miss_detail.responseText` stays agent stdout.
- `v2/docs/v1-behaviors.md` — record v2 plan-draft normalizer rejection diagnostics.

## Prerequisites
