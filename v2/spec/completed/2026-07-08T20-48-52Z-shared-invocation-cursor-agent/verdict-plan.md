## Verdict

Refinement required. The following gaps in the spec draft must be addressed before implementation:

1. **Quota classification must be agent-parameterized, not just agent-specific in name.** Add an explicit Decision stating classifiers are parameterized by `agentId` (mirroring v1's `isQuotaSignal(name, exitCode, stderr)` shape), and that `AgentName`/equivalent type is widened to include `"cursor"`. This is load-bearing: without it, an implementer could bolt Cursor patterns onto the existing Claude-only classifier path, which the current code's own warning comment says not to do without review.

2. **Fix the porting reference for quota patterns.** Cursor's quota regexes live in `v1/src/agents/quota.ts`, and the `AgentName`-dispatched spawn shape is in `v1/src/agents/spawn.ts` — not `cursor.ts`/`cursor-tokens.ts` alone. Update the intent Prerequisites and subspec task list to cite these files so the implementer ports vetted patterns instead of inventing new ones.

3. **State the adapterModel input contract explicitly.** Add a Decision (or expand the existing model-mapping task) clarifying: `adapterModel` arrives as a display name (e.g., `"Composer 2.5"`), is mapped through the ported CLI-slug table, and falls through unchanged when unmapped (matching v1's `?? model` behavior). This is required for the "Cursor model slug mapping" test to be written correctly.

4. **Clarify telemetry's `metadata.model` value.** State explicitly whether the emitted model field is the raw `adapterModel` or the CLI-slug-mapped value, and keep it consistent with the existing Claude binding's behavior unless a deviation is justified.

5. **Add a one-line Decision on the zero-exit quota envelope.** State whether Cursor has a zero-exit quota check (likely: no, matching v1) rather than leaving it inferable only by omission.

6. **Add a deferral line for auth-signal/lenient-quota-fallback.** Per the spec-guidance principle of stating deferrals explicitly rather than by silence, add: no auth-signal or lenient-quota-fallback path in this slice (matches v1 Cursor, which has none either).

7. **Add a task item to update the stale "not yet generalized without review" code comment** once Cursor wiring lands, so the next agent-wiring slice isn't misled by outdated guidance.

8. **Correct task wording direction for model mapping** (label → CLI slug, not the reverse) and add a one-line confirmation that no `resolveCursorPriceKey` port is needed, since `priceKey` already stays binding-args-sourced per the existing Decision.

Items 1–3 change what the implementer builds and must be resolved in the next draft. Items 4–8 are each a single Decision/task-line addition.