---
id: plan.decisions-ledger
behavior: plan
kind: fragment
revision: 2
order: 0
---
Record decisions, constraints, and assumptions as a ledger of atomic entries, one per line; do not write narrative paragraphs.
For each entry, state the decision; add a one-line trailing rationale clause only when the why is non-obvious.
Record only load-bearing decisions: ones where a competent implementer would plausibly choose differently and the difference is observable or costly to reverse. Each entry must name the plausible wrong alternative it rules out; if it has none, it is a default any reasonable implementer — including a smaller, cheaper model — would reach anyway, so omit it.
Do not record decisions for thoroughness's sake. Entry count is governed by this test, never by a cap or a target; terseness governs the prose within each entry.
Do not add narrative justification paragraphs around the ledger; the ledger is the record.
Keep each subspec one independently reviewable change; when it would not be, split it rather than absorb scope.
