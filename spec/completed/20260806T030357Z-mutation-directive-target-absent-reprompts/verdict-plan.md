# Verdict: required refinements

The spec’s behavioral boundary (reprompt vs hard-block, single execution-loop seam, bounded repair) is sound and correctly scoped. Refinement is needed so implementers cannot satisfy acceptance criteria with a string-parse bridge, silent exhaustion, or incomplete observability. Required outcomes:

## 1. Wiring contract for reprompt lifecycle

The spec must name, at outcome level, how reprompt differs from terminal settle:

- **Classification seam**: loop-owned intercept of `spec.criteria-ticked` `contract_miss`, using structured unparseable entries (not `failureReason` string parsing).
- **Durable log event**: a named kind carrying `pinningFile:line`, raw directive, and reason; sufficient for resume/audit.
- **Prompt injection**: how reprompt context reaches the next write-step prompt (dedicated prompt ID or placeholder block — analogous to landing reprompt, not in-step `blocker_reprompt`).
- **Resume**: whether pause/resume replays reprompt context from log (landing precedent) or explicitly defer.
- **Progress boundary**: reprompt path commits in-progress progress before `continue` (mirrors landing reprompt; avoids resume/accounting drift).
- **Observability skip**: first repromptable miss skips the full terminal bundle (`contract_miss`, `contract_miss_detail`, `appendBlockerToSpec`, terminal boundary settle) and emits the reprompt event instead.

*Rationale*: Intent forbids terminal settle on fixable pin-text mismatch; without these seams an implementer can satisfy “reprompts” behaviorally while omitting durable telemetry, resume, or progress accounting.

## 2. Payload format anchored to existing vocabulary

Acceptance criteria must state that prompt and test-pinned text reuse `describeUnparseable` shape (`pinningFile:line: reason: raw`), with structured fields in the log event and display derived from them. Tests pin that text, not an invented format.

*Rationale*: Resolves the “verbatim payload” AC ambiguity and prevents test-authoring traps.

## 3. Budget-exhaustion acceptance criterion

The exhaustion AC must assert terminal hard-block includes harness `## Blocker` append (or equivalent `appendBlockerToSpec` call), not only `contract_miss` / `resumable: false`.

*Rationale*: Decision ledger says exhaustion follows the existing hard-block path; current AC allows passing without blocker append.

## 4. `target_ambiguous` behavioral coverage

Add named coverage for `target_ambiguous` (parameterized reprompt test or sibling case). One reason alone is insufficient per spec-guidance’s failing-test expectation for distinct verifier outcomes sharing one predicate.

## 5. Terminology alignment with harness vocabulary

Replace “missing-directive” with **hollow** and “red scoped suite failures” with **hollow checkpoint** (scoped suite stayed green) in intent, decision ledger, and task checklist.

*Rationale*: Prevents implementers from inventing nonexistent reason codes or misreading verifier semantics.

## 6. Multi-directive reprompt rule

State explicitly: when multiple blocking unparseables are all repromptable (`target_absent` / `target_ambiguous`), one reprompt carries every offending directive (same listing shape as today’s blocker text).

## 7. Mixed-failure hard-block negative

Add one acceptance criterion (or explicit AC clause) that a miss mixing repromptable reasons with hollow, `unresolved_pinning_test`, or other unparseable reasons still hard-blocks — does not reprompt.

*Rationale*: Task checklist predicate (“every blocking entry is repromptable”) is the core guard; without a negative AC an implementer can reprompt on mixed failures and still pass reprompt tests.

## 8. Mutation-checkpoint guard location

The inversion `@mutate` AC must name the file hosting the reprompt predicate (expected: `write-loop.ts` or whichever file owns the intercept), not only the enclosing test name.

*Rationale*: Guard-inversion ACs must sit on the branch they guard; misplaced directives give false confidence.

## 9. Documentation acceptance coverage

- Add an AC that `v2/docs/v1-behaviors.md` records the reprompt vs hard-block boundary (repo rule for behavior changes).
- Extend documentation updates to close the related `v2/spec/implement-queue.md` item when deleting the 2026-08-05 operator-runbook bullet — avoids stale operator guidance.

## 10. Optional hygiene (non-blocking)

Merging duplicate AC rows for the same test (behavior vs payload) reduces partial-tick ambiguity; not required if both clauses remain in one tickable item.

---

**No split required.** Single subspec, one module boundary, atomic and independently testable once refinements above land.