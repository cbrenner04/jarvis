# Propagate plan draft normalizer reason

repo: cbrenner04/jarvis

Plan-draft normalizer rejections today settle `contract_miss` / `artifact.exists` with
static `plan.draft.shape`, discarding the deterministic throw message.

- [ ] [00 - Step contract check carries dynamic failure reason](./00-step-contract-check-failure-reason.md)
- [ ] [01 - Plan-draft normalizer message on contract miss](./01-plan-draft-normalizer-contract-miss-reason.md)
- [ ] [02 - Plan-draft contract_miss loop diagnostics and docs](./02-plan-draft-contract-miss-loop-diagnostics.md)

Land **00 → 01 → 02** when batched: later subspecs depend on `failureReason` plumbing from
earlier ones. Operator-facing docs (`write-behavior.md`, `v1-behaviors.md`) land with subspec 02;
do not merge 01 without 02 or an explicit docs follow-up.
