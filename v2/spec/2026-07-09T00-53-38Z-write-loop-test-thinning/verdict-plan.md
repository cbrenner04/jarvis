**Verdict**

Two findings are upheld and require refinement; the rest do not.

1. **AC1 (crash-resume pair A) must name the state-store assertions from the no-sink original**, not just event/attemptId behavior. The merged test loses coverage if the AC doesn't force the implementer to carry over the specific fields the no-sink test checked (attempt count, attempts-length/history, outcome kind, resumed iterations-consumed). List these fields explicitly in AC1 rather than describing them by category.

2. **AC3 (abort collapse) must name the specific event-sequence field the sink-with-full-sequence original asserted** (the iterations-consumed value on the relevant event), in addition to the categories already listed (`result.kind`, `iterationsConsumed`, `resumable`, event-kind sequence, final event's outcome kind, state-store attempt statuses). Without naming it, an implementer following only the current AC text can drop that specific assertion.

Rationale: both gaps stem from the same risk — the Decisions section promises "every distinct assertion from both originals" survives, but the ACs describe assertion categories rather than the concrete fields, leaving room for a literal implementation to under-cover. Per spec guidance's refactor/preservation AC rule, behavior-preserving merges should anchor to what the original tests actually assert rather than leaving it to paraphrase/inference.

**Optional, low-cost addition (not required but worth taking if convenient):** add one line to Decisions stating that standardizing on always-passing a `logSink` in the merged/collapsed tests is safe because the surviving `calls executeWrite repeatedly until terminal` test still exercises the no-sink path independently. This removes an inference the current draft leaves implicit.

**No change needed** on: the verification-command scope (already governed unconditionally by CLAUDE.md's test-scoping convention, not something individual subspecs must restate), and on pre-computing baseline/expected test counts in the spec (the intent already assigns this to the PR body at implementation time, consistent with deferring precision to the point where the actual file is in hand).