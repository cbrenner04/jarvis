1. Restore truthful spec completion. Reword the unchecked `patch.prompt.body` criterion so it does not contain a human-only marker, then check it only after its automated coverage is satisfied. The current marker substring causes false human-only classification while the index claims completion.

2. Align durable documentation with actual parser semantics. `v1/docs/run-loop.md` and related operator guidance must state case-insensitive substring matching anywhere in the full bullet block, without obsolete trailing or whole-phrase implications.

3. Cover the v1 shrink renderer’s independent `DEFAULT_WRITE_STEP_RULES` binding. The spec’s claimed existing wholesale shrink coverage does not exist; rendered coverage must prove the shared human-only contract reaches `patch.prompt.shrink`.

4. Include `write.ready-repair` and `write.mutation-repair` in the shared-rules consumer contract, durable documentation, and regression coverage. Both inherit and render `stepRules`, so omitting them makes the consumer inventory incomplete.

5. Cover every distinct bundled spec-guidance path affected by the documentation change, including v2 plan review rendering and the v1 verdict actuator. Coverage must isolate `SPEC_GUIDANCE` so the contract cannot be supplied by another prompt injection.
