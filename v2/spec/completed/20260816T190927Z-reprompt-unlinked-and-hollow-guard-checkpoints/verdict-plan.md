1. Split the oversized subspec into two serial, independently testable subspecs: verifier report enrichment first, then execution-loop admission, prompting, precedence, and lifecycle. Assign every existing task and acceptance outcome exactly once across the replacements and link both from `index.md`.

2. Require hollow findings to identify each linked mutation directive unambiguously, including its source location or equivalent stable identity. Criterion, pin path, and reason alone are insufficient when multiple directives link to one criterion.

3. Preserve the distinct keystone contract in combined repair sets. Entries must distinguish guard from keystone repairs, and unlinked keystones must receive headline-revert guidance rather than guard-directive guidance.

4. Clarify admission boundaries: unresolved or ambiguous target findings remain terminal when mixed into a guard-repair report, while pure `target_absent` or `target_ambiguous` reports retain their existing mutation-directive reprompt behavior. Behavior, decisions, tasks, and acceptance criteria must agree on this distinction.

5. Add a named pre-fix-failing aggregation test covering multiple guards with both unlinked and hollow reasons in one report. It must prove one prompt includes every finding, resolved pin path, directive identity where applicable, and reason-specific instruction.

6. Add mutation-checkpoint coverage for the directive-present-versus-absent reason mapping. Inverting that classification must turn the aggregation pin red, satisfying the guidance that every added or modified guard is mutation-tested.

7. Make lifecycle outcomes observable and precise: budget exhaustion permits no extra iteration and appends the latest completion report’s normal checkpoint blocker; guard context takes precedence over narrower keystone context; arm changes do not render stale sibling instructions; and terminal settlement emits no repair prompt. Avoid claiming direct proof of process-local destruction unless an observable seam verifies it.
