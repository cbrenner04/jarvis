---
name: plan-draft-contract-swallows-the-normalizer-reason
---

# A plan draft rejected by the normalizer reports only `artifact.exists`

## Problem

`executePlanDraftWrite`'s `artifact.exists` contract calls `validatePlanDraft`, which wraps
`normalizePlanDraftSpecDir` in a bare `try { … } catch { return false }`
(`v2/src/execution/write.ts:216-224`). The normalizer throws named, specific errors — multi-surface
acceptance bullets, missing index links, cross-boundary decisions — and every one of them is
discarded. The operator sees `contract_miss` / `failedContractId: "artifact.exists"` with reason
`plan.draft.shape`, which reads as "the agent wrote no spec tree."

The agent had written a complete, well-formed spec tree. `.jarvis-plan-stage/` held `index.md`,
`00-<name>.md`, and `intent.md`, all with mtimes *before* the contract check.

Observed 2026-07-30 on `ready-intents/cleanup-eligibility-uses-live-socket-discovery.md`: two
consecutive plan dispatches (`0152df60`, `6b43ed2b`) settled `blocked` / `contract_miss` this way.
Diagnosis required hand-running the normalizer against the stage directory, which reported in one
line what two runs could not:

```text
Plan subspec 00-cleanup-eligibility-uses-live-socket-discovery.md has a multi-surface
## Acceptance criteria bullet: … a regression test in `cleanup.test.ts` or `cleanup-cli.test.ts` …
```

The same shape is recorded for `guard-bare-settimeout-in-deterministic-tests` ("two plan dispatches
settled `contract_miss` — retry or hand-draft"). Retrying is the wrong recovery: the input is
deterministically rejected, so every retry burns a full plan run to reach the same wall.

## Decisions

- `validatePlanDraft` returns the normalizer's thrown message instead of a bare boolean, and the
  `artifact.exists` contract surfaces it as the contract reason — rules out the current
  catch-and-discard.
- The message reaches the operator on the durable row: `contract_miss_detail` carries it, and
  `jarvis run wait` / `run list` name it — rules out a fix that only improves a log line the
  operator has to know to grep for.
- The reprompt handed back to the agent includes the same message, so a retry is informed rather
  than identical — rules out leaving retry blind.
- A draft that fails normalization keeps reporting `contract_miss`; this changes the diagnostic,
  not the verdict — rules out admitting a malformed spec tree.
- Not in scope: whether a criterion naming two test files (`a.test.ts` or `b.test.ts`) *should* be
  rejected as multi-surface. That is the normalizer's policy question, tracked separately.

## Acceptance criteria

- [ ] Given a staged plan draft whose subspec has a multi-surface acceptance bullet, the plan write
      step settles `contract_miss` whose reason contains the normalizer's message, including the
      offending subspec filename and the bullet text.
- [ ] Given a staged plan draft whose `index.md` omits a link to a present subspec, the settled
      reason contains the normalizer's index-link message — proving the reason is propagated, not a
      single hardcoded string.
- [ ] Given a stage directory with no `index.md`, the settled reason still reports the missing-shape
      case and does not claim a normalizer error.
- [ ] `jarvis run log <id>` `contract_miss_detail` for a normalizer rejection carries the message,
      and `jarvis run wait` reports it on the row.
- [ ] Inverting the guard that propagates the normalizer message (reverting to a bare boolean) makes
      the first two tests fail.
