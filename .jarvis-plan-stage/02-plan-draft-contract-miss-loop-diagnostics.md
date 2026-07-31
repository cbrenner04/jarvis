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
- Harness-appended blocker uses propagated `failureReason`, not a generic shape slug — rules out
  leaving the next plan attempt blind to the deterministic rejection.
- `ContractMissDetailEvent` in `log-stream.ts` carries the optional field — rules out ad-hoc
  parsing of `responseText` for normalizer text.
- Deferred to first consumer: TUI/list-row projection of `contract_miss_detail.failureReason` —
  pin when `surface-contract-miss-reason-on-run-rows` ships.

## Task checklist

- Add optional `failureReason` to `ContractMissDetailEvent` and append it from `write-loop.ts`
  on `contract_miss` boundaries.
- Add `write-loop.test.ts` plan-draft normalizer regressions for log detail and harness blocker
  text.
- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `write-loop.test.ts` drives a plan-draft normalizer `contract_miss` and asserts
      `contract_miss_detail.failureReason` matches the step `failureReason`; `responseText`
      remains agent stdout; it fails against the pre-fix code.
- [ ] `write-loop.test.ts` drives a plan-draft normalizer `contract_miss` and asserts the
      harness-appended `## Blocker` body contains the normalizer message; it fails against the
      pre-fix code.
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
