Reviewing implementation, precedents, and parent spec to issue a self-contained verdict.
## Required outcomes

1. **Guard-inversion checkpoint must use selectable-member cardinality.**  
   The inline checkpoint on `collapsed table shows one top-level row for a multi-run workflow` must describe full collapse bypass as one top-level rendered row per **selectable** (non-queued) shared-invocation member — the input `buildWorkflowTableRows` actually receives via `orderedSelectable`. For the pinning fixture, bypass yields **two** top-level rows (`run-implement`, `run-review`), not three; `run-verify` is queued and excluded. The current “N … members” wording misstates the observable and would mislead the next operator running the manual mutation check the subspec depends on.

2. **Completed parent collapse subspec must match current verification.**  
   `v2/spec/completed/20260724T230804Z-tui-limits-terminal-rows-to-one-hour/01-tui-collapses-workflow-to-one-row.md` still requires automated invert/disabled-collapse CI coverage (“every constituent run must appear as its own top-level row … under inversion”). That is no longer true on HEAD and contradicts this patch’s deliberate tradeoff (manual guard mutation on the real collapse path; no production test hook; no dedicated invert `test()`). Amend that completed AC so durable spec history records: invert proof is operator-only source mutation on `seenInvocations` dedup + `workflow-collapsed` emit in `buildWorkflowTableRows`, anchored by the named pinning test turning red, with a cross-reference to `20260730T071756Z-workflow-collapse-drops-test-flag`. This is spec archival alignment, not operator-runbook churn — the subspec’s “Documentation updates: None” correctly excluded operator-visible docs only.

## Rationale

Core implementation meets the subspec: production test state is removed, the invert test is dropped, the pinning test still asserts collapsed rendered monitor text, and manual verification is recorded. The two gaps above are maintainability and durable-contract accuracy, not functional regressions.

- **Outcome 1** keeps the human-only guard-inversion contract trustworthy; an inaccurate checkpoint repeats the original failure mode (verification that reads green without matching real collapse semantics).
- **Outcome 2** prevents the completed parent AC from falsely requiring CI invert coverage that this patch explicitly removed; without it, reviewers comparing parent spec to HEAD see a contradiction with no durable explanation.

## Not required

- Restoring `setInvertWorkflowCollapseForTest`, a dedicated invert `test()`, or any production bypass hook.
- Requiring every test in `tui-monitor-workflow-collapse.test.ts` to fail on dedup mutation (subspec scopes proof to the named pinning test; expanded-row and twenty-row-cap tests exercise different surfaces).
- Automated CI negative-path coverage for N visible top-level rows (accepted tradeoff).
- Reverting `expect(body).toHaveLength(1)` — equivalent to the prior filtered assertion for this fixture given `tableBodyLines` slicing.
- Mandatory file-level removal comment or exact mutation recipe in code (inline checkpoint satisfies the subspec; recipe precision is optional hardening beyond these two outcomes).