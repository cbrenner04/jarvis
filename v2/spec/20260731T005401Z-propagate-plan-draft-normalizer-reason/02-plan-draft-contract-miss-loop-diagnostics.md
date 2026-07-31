# Plan-draft contract_miss loop diagnostics and docs

## Problem

Plan-draft normalizer `contract_miss` rows expose `failureReason` on the step result (subspec
01), but `contract_miss_detail` logs only `responseText` (agent stdout). Harness-appended
`## Blocker` text falls back to `failedContractId` when `failureReason` is absent on the log
event path operators read alongside stdout.

## Decisions

- `contract_miss_detail` adds optional `failureReason` for the settled contract diagnostic —
  rules out overloading `responseText` with the contract reason.
- `responseText` stays the final agent stdout used for contract evaluation (unchanged) — rules
  out replacing invocation output with the deterministic rejection text.
- Harness blocker append is largely pre-wired once `failureReason` propagates (subspec 01);
  subspec 02’s distinct deliverables are `contract_miss_detail.failureReason`, loop tests, and
  docs — rules out re-implementing blocker body text from scratch.
- `plan.prompt.draft` + `artifact.exists` `contract_miss` appends `## Blocker` to
  `join(expectedArtifactPath, "intent.md")` under the worktree (same routing pattern as
  `spec.criteria-ticked` uses `expectedArtifactPath`), not durable `specPath` — rules out
  appending to a durable path that may not exist on first draft.
- `ContractMissDetailEvent` in `log-stream.ts` carries the optional field — rules out ad-hoc
  parsing of `responseText` for normalizer text.
- Including the normalizer message in the next plan agent reprompt is out of scope (deferred;
  not covered by this spec or `surface-contract-miss-reason-on-run-rows`).
- Deferred to first consumer: TUI/list-row projection of `contract_miss_detail.failureReason` —
  pin when `surface-contract-miss-reason-on-run-rows` ships.

## Task checklist

- Add optional `failureReason` to `ContractMissDetailEvent` and append it from `write-loop.ts`
  on `contract_miss` boundaries.
- Route `plan.prompt.draft` + `artifact.exists` blocker append to staging
  `join(expectedArtifactPath, "intent.md")` when not already wired.
- Add `write-loop.test.ts` plan-draft normalizer regressions for log detail, blocker path, and
  body text.
- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `write-loop.test.ts` drives a plan-draft normalizer `contract_miss` and asserts
      `contract_miss_detail.failureReason` matches the step `failureReason`; `responseText`
      remains agent stdout; it fails against the pre-fix code.
- [ ] `write-loop.test.ts` drives a plan-draft normalizer `contract_miss` and asserts the
      harness-appended `## Blocker` at `join(worktreePath, expectedArtifactPath, "intent.md")`
      contains the normalizer message in its body; it fails against the pre-fix code.
- [ ] `log-stream.test.ts` (or an equivalent typed fixture beside `log-stream.ts`) asserts
      `contract_miss_detail` is assignable with optional `failureReason`; it fails against the
      pre-fix code.
- [ ] Inverting the `write-loop.ts` guard that copies `failureReason` onto `contract_miss_detail`
      turns the log-detail test RED.

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft shape `contract_miss` carries the normalizer message
  in `failureReason`, `contract_miss_detail.failureReason`, and the harness-appended blocker;
  distinct from bare missing-tree `plan.draft.shape`; `contract_miss_detail.responseText` stays
  agent stdout.
- `v2/docs/v1-behaviors.md` — record v2 plan-draft normalizer rejection diagnostics.
