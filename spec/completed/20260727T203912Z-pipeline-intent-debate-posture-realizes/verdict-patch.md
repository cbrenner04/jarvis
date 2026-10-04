Verifying documentation gaps the advocate flagged against the spec acceptance criteria.
## Verdict — required outcomes

1. **`v2/docs/daemon-host.md` must match the doc acceptance criterion** (subspec: both docs agree on realizability policy). Today the debate table row is correct, but the pipeline section is still wrong/incomplete:
   - **Authority text** still names `isUnrealizableReview`, which no longer exists; admission is only `validatePipelineDefinition` with an inlined `implement` + `none` check. Operator docs must not cite removed symbols.
   - **Unrealizable policy** must match `v2/docs/workflow-runner.md`: `intent` + `debate` is realizable; **`implement` + `none` is the only unrealizable admission cell** (same meaning as the workflow-runner matrix footnote and `unrealizable-review-posture` row). `daemon-host.md` must state that explicitly near the posture table, not only via the new debate row.

2. **Rationale:** Subspec decisions and the checked doc AC require lockstep `workflow-runner.md` / `daemon-host.md` alignment on posture tables **and** unrealizable prose. Code and `workflow-runner.md` already reflect single-cell unrealizability; `daemon-host.md` still describes the old admission model. That is an operator-facing contradiction and fails the stated AC even though behavior and tests are correct.

## Not required before merge (actuator may skip)

- CI invert-guard / mutation tests for re-adding the debate branch (repo convention; AC describes implementer checks, not mandatory automation).
- Syncing `intent.md` or ticking the subspec **Task checklist** (housekeeping; does not block the behavioral contract).
- Extra tests: dedicated `intent` + `debate` role-binding, explicit “`intent-reviewed` not invoked,” deeper unmapped-resolution messages, integration additions, or symmetric real-builder coverage for `intent` + `light`.
- `v1-behaviors.md` source list tweaks (catalog line is adequate).
- Optional `workflow-runner.md` polish beyond table + unrealizable/error rows already updated.
- Re-exporting a shared realizability helper for the ready-intent/CLI alignment spec (forward debt, not this slice’s behavior).

**Summary:** Land the behavioral change as-is; **close the PR only after `daemon-host.md` authority and sole-unrealizable admission wording align with `workflow-runner.md`.**