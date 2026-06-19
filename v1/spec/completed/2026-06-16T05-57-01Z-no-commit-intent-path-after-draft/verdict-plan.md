- Add committed full-pipeline stdout preservation to acceptance criteria, not only the task checklist. Acceptance is the enforceable contract, and the intent requires committed plan output to remain unchanged.

- Strengthen ordering around the early `intent.md` print. The spec must require the path to be emitted after the external `intent.md` is written and before refine begins, so later refine, draft, or review failures cannot hide the artifact.

- Pin the operator-facing stdout line shape enough for docs and regression tests to agree. This is public behavior for plan mode, so deferring the label/format creates avoidable ambiguity.

- Remove the deferred stdout-label decision once the line shape is pinned. If any deferred entry remains, it must use the required inline format exactly.

- Ensure failure-path coverage proves placement before refine invocation, not merely before an observed failure message. Stream ordering around reported failures can be ambiguous; the behavior that matters is the artifact path becoming visible before later phases run.
