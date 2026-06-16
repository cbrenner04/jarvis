## Verdict

The spec's chosen behavior (Decisions ledger) is sound and requires no reversal. The defects are in the **task checklist under-instructing the implementer** — each gap lets a green-looking implementation violate a stated acceptance criterion. Refine the following.

### Required refinements

1. **Fix the tracked-state invariant (criterion #4).** The checklist says "track that a quota result was seen," but exit 2 must fire only when *every* attempted agent returned quota. A `model_config → quota` chain that "saw quota" would wrongly select exit 2. The correct tracked state is whether any **non-quota fallthrough** occurred, not whether quota was seen. Reword the checklist so it matches its own Decisions section.

2. **Call out that the existing catch-all `return 3` must be replaced, not coexisted with.** Today exit 2 is set inside the loop before `break`. Once that becomes `continue`, nothing sets exit 2 in-loop, and the all-quota chain falls through to the post-loop generic `return 3`, breaking criterion #2. The spec must make explicit that the new terminal logic supersedes the existing generic-failure return for the all-quota case.

3. **Pin the rotation-language emission, which is new behavior.** Prompt mode currently emits only raw stderr on quota; emitting the shared harness rotation strings is net-new and the checklist omits it. The spec must resolve two real decisions: (a) which line to emit on per-agent quota fallthrough (strict vs lenient), given prompt mode applies the lenient-allowed conversion once and cannot mirror patch's two-branch structure verbatim; and (b) whether the rotation line replaces or augments the raw `result.stderr`. Default to matching patch-mode behavior, since log consistency is the stated goal.

4. **Require terminal-agent capture on every continue path.** The terminal telemetry row must report the last attempted agent (and its configured model). Converting quota to `continue` must keep updating the terminal-agent state on each attempt; otherwise the all-quota row reports an unknown/wrong agent, defeating the single-row telemetry decision.

5. **Disambiguate "terminal outcome" for the mixed chain (one-line pin).** For a `model_config → quota → (no success)` chain that exits 3, specify what `telemetryKind`/`exitReason` record, so it is not left to "last write wins" (which would be `quota`). Fold into refinement 1.

### Optional (operator's call, not blockers)

- An all-`model_config` exhaustion test is cheap insurance given the spec is specifically about which kinds fall through, but is subsumed by the mixed-chain criterion; omission is defensible.
- Correct the Problem section's seam/path references (`buildActiveAgents` and the rotation-message helper live in patch-mode `run.ts` / `v1/src/` root, not in the prompt file or under `agents/`) so they don't imply the seam already exists in prompt mode. Cosmetic.

### Rationale

The intent demands the implemented behavior and the docs/tests match the exact fallback policy, with acceptance criteria distinguishing exit 2 (all-quota) from exit 3 (mixed/non-quota fallthrough). The Decisions ledger encodes this correctly, but a literal implementer follows the task checklist — and as written it can produce exit 3 for the all-quota case (refinement 2), exit 2 for the mixed case (refinement 1), wrong telemetry agent (refinement 4), and missing/ambiguous quota-log language (refinements 3, 5). These are precision fixes that align the checklist with the already-correct Decisions, not new scope.