## Verdict: Refinements Required

The spec's spine is sound — duplicate-section→fail, parser reuse, blocker short-circuit first, the severity split, and the net-new `warnings` channel are all correct and should be preserved. The following must be addressed before this draft is ready.

### Required (blocking)

1. **Define the structural-AC classifier's discriminating rule, not just its tokens.** The spec defers the entire decision of *what makes an AC "structural" vs "behavioral"* to implementation, yet an acceptance criterion ("an AC naming only implementation structure warns") cannot be reviewed without that rule. Deferring exact verb/keyword tokens is acceptable per repo guidance; deferring the load-bearing rule shape is not. Pin the *approach* (e.g. keyword-trigger vs symbol-detection) even if exact tokens defer.

2. **Resolve the structural-AC check's near-certain false-fire on this repo.** This validator runs in jarvis against any target repo, but the dominant use is harness plans, where `spec-guidance.md` explicitly blesses ACs that name internal structure — and subspec 00's own ACs (naming `validateDraftOutput`, `shared/spec-parser.ts`) would trip a coarse classifier. A warning that fires on most valid harness ACs trains the operator to ignore the channel, which also dulls subspec 01's anchor warning sharing it. The spec must either sharpen the trigger or scope the structural-AC check to product-mode plans, and own this trade-off explicitly rather than ship a check guaranteed to misfire on its own repo.

3. **Specify how parser signals map to gate severity.** The shared parser returns warnings as human-readable prose. For the gate to promote near-miss-heading warnings to **fail** while keeping structural-AC as **warning**, it must distinguish them without fragile string-matching of parser prose. Pin the integration contract: categorized/structured parser warnings, or the gate re-deriving near-miss/duplicate conditions itself. This is the integration core and is currently unspecified. (The parser is already being extended for duplicate detection, so adding structured categories is in-scope.)

4. **Catch the absent/empty acceptance-criteria section.** A subspec with no `## Acceptance criteria` section yields zero criteria and trips none of the three checks — yet "silently unparseable, index never completes at run time" is exactly the failure class this spec exists to close. Add an acceptance criterion requiring each generated subspec to expose ≥1 parseable criterion under the exact heading (else fail), or explicitly scope it out with rationale. In-scope is recommended: it is cheaper and higher-value than the structural-AC warning.

5. **Give the cite-a-test convention a single authoritative source for the implementer (subspec 01).** The `refactor-acs-cite-tests` convention 01 enforces exists only as a raw-seed wip-intent, not a landed convention with a canonical verb-set/anchor definition — yet 01 builds enforcement and a doc update citing it. Either inline the definitive trigger-verb set and anchor rule into 01, or land the convention's durable definition first and list it under 01's `## Prerequisites`.

### Required (refinements)

6. **Tighten the anchor pattern in subspec 01.** "Backtick-wrapped source path" is loose enough that an ordinary backtick span (e.g. `` `patch_phase: "shrink"` ``) could read as an anchor and *suppress* a warranted warning — silent defeat of the check, worse than a false warning. Require a path-like / `*.test.ts` form rather than any backtick span. Pin this in 01's deferred-pattern note.

7. **State that patch-mode parsing is unchanged.** Subspec 00 already lists `v2/docs/v1-behaviors.md`, but the note must record that the shared-parser change is additive — duplicate detection added, first-occurrence ticking behavior preserved — so the parity baseline shows the module gained a capability without altering patch behavior.

8. **Name the resume/review gap.** Validation runs only before the draft commit; `plan: review N rM` passes can re-introduce malformations. This is an intentional scope boundary, but the spec should name it so the structural guarantee is not assumed to hold post-review.

9. **Make the 00→01 dependency explicit.** Subspec 01 builds on the warnings channel introduced in 00 and is not independently landable. State this ordered dependency in the index/01 rather than implying independence.

### Rationale

Items 1–4 are correctness gaps in the spec's central mechanism: the classifier rule, the parser→gate contract, and the missing-section case are the parts a competent implementer would otherwise have to invent, and the structural-AC false-fire would undermine adoption of the very channel both subspecs depend on. Item 5 closes a prerequisite gap (enforcing a convention with no shipped definition). Items 6–9 are bounded clarifications that prevent silent check-defeat and keep the parity baseline and subspec-independence guidance honest.

### Already adequate — no action

The `warnings`-channel design is correctly owned as net-new in subspec 00 (the intent's "per existing severity patterns" wording was inaccurate, but the subspec corrected it), and there is a single call site, so no caller fan-out concern remains.