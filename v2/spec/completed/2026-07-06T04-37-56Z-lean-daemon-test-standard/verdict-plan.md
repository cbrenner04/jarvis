## Verdict

Refinement required. The following gaps in the current draft must be closed:

1. **Line 37 contradiction**: `test-writing.md` line 37 currently cites `daemon-start-list.test.ts` as a blessed example of an agent-runnable socket test. That statement directly conflicts with the new "1-2 round-trip smokes per handler set" cap. The subspec's Documentation updates section must expand to cover this line — either drop the citation or reframe it to match the narrower allowance. Otherwise the doc ships self-contradictory.

2. **Disposition of pre-existing violations**: `daemon-start-list.test.ts` (29 socket cases) and `daemon-tail-stream.test.ts` (5 socket cases) already exceed the new cap by a wide margin. Migrating them is out of scope (docs-only intent), but the doc must say so explicitly — one sentence stating the standard applies to new tests going forward and does not retroactively require migrating existing files. Without this, the doc is ambiguous about whether existing tests are now "defects."

3. **Define "handler set"**: AC3's cap ("1-2 round-trip smokes per handler set") is unenforceable without a definition. The spec must specify the unit — e.g., one budget per exported handler factory (`createRunControlHandlers`, `createTailStreamHandler`) — so the allowance and the checklist rule are checkable.

4. **Clarify the two round-trip allowances don't overlap**: `ipc.test.ts` itself exercises `createTailStreamHandler` through `startIpcServer`. The doc must state explicitly that the `ipc.test.ts` transport-suite carve-out is separate from and not counted against the per-handler-set smoke budget, so the two allowances read as additive rather than ambiguous/overlapping.

5. **Fix the forward-reference risk**: wherever the new determinism-checklist rule cross-references the three retained round-trip allowances, the spec must ensure that reference is concrete (name the three cases inline or point at the specific doc section) rather than relying on a positional "above," since actual placement in the finished doc may not match draft order.

## Rationale

These are enforceability and internal-consistency gaps in the acceptance criteria and documentation-updates scope, not scope expansion — every fix stays within the docs-only edit to `v2/docs/test-writing.md` that the intent already authorizes. Per spec guidance, acceptance criteria must be verifiable; an unenforceable cap ("per handler set" undefined) or a self-contradicting doc (line 37 vs. new cap) fails that bar. Leaving pre-existing violations undiscussed creates exactly the kind of ambiguity the determinism-smell checklist is meant to prevent.

Not required: tightening AC1 to explicitly cover surrounding prose, and adding a "Fix by..." remediation clause to the new checklist bullet, are minor stylistic improvements the refiner may apply but are not blocking.