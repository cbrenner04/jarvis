Verifying key codebase claims before issuing the verdict.
## Verdict: required refinements

1. **`v2/docs/v1-behaviors.md` must be in Documentation updates.** This change alters observable `invocation_completed` row shape, not purely net-new telemetry. Spec guidance requires updating the v1 parity catalog when existing behavior changes. The Codex bullet at line 409 currently says warnings are preserved in adapter metadata but not surfaced on shared telemetry rows; after this work that is wrong for warnings (usage/cost unavailability can remain accurate).

2. **The `@mutate` checkpoint must be satisfiable against real `createInvocationCompletedRecord` layout.** Today the returned object ends with `exit_reason` and no trailing comma. A directive that targets `warnings: okResult?.warnings ?? [],` (with trailing comma) only works if `warnings` is not the final property. The spec must commit to where `warnings` lives in the record (e.g. with usage/cost, before `exit_kind`/`exit_reason`) or pin a mutation substring that does not depend on trailing-comma placement. Otherwise AC #3 cannot be verified.

3. **Non-ok empty-`warnings` coverage must include every non-ok `exit_kind`.** The decision says all non-ok rows emit `warnings: []`. `InvocationResult` also includes `model_config`, which AC #2 and tasks omit. Extend acceptance criteria and tasks so `model_config` is covered alongside `quota`, `stall`, and `error`.

4. **Acceptance criteria must require the field to be present, not merely coalesce to empty.** Because `warnings` is an always-present array on new rows, tests should assert `row.warnings` directly (`toEqual([...])` / `toEqual([])`). Assertions like `row.warnings ?? []` would pass on pre-fix code with no field and weaken the failing-test contract.

5. **Verification scope should match repo convention for `shared/**` changes or state why the narrower gate is sufficient.** The subspec AC names only `bun run typecheck` and `bun run test:shared`. Repo guidance unions broader test surfaces for `shared/**`. Either align the AC with that scope or add an explicit note that the ready gate / CI still runs the full shared surface so implementers are not misled into stopping early.

---

**Rationale:** Items 1–4 close real completeness gaps — parity doc drift, an unsatisfiable mutation checkpoint, incomplete exit-kind coverage vs the stated decision, and a test assertion that would not fail pre-fix. Item 5 removes implementer ambiguity without changing the technical design.

**No split required.** One subspec on `shared/invocation/execute.ts` remains appropriately atomic.

**Not required:** end-to-end codex/quota-fallback chain tests, `shared-invocation.md` cross-ref, mixed-era JSONL consumer guidance, intent prerequisite wording, or naming a specific test function in AC #3 (file-level `@mutate` linkage is sufficient per spec guidance). Optional strengthens may be noted in Tasks but should not block merge.