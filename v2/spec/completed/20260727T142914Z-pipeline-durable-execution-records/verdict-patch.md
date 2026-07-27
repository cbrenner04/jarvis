## Verdict — required outcomes

1. **A patch whose only fields are `undefined` must not silently succeed.**
   `artifact?: unknown` and `failureDetail?: unknown` are not protected by `exactOptionalPropertyTypes` (`unknown` subsumes `undefined`), so `{ artifact: maybeUndefined }` typechecks, passes the empty-patch guard (key is present), and binds a `JSON.stringify(undefined)` result. Subspec 01 requires rejecting empty patches and guarantees no silent no-op updates. Required: undefined-valued fields are treated as absent, a patch that reduces to nothing is rejected, and a regression covers it.

2. **The parent-integrity criterion must be proven against the store's own connection.**
   `PRAGMA foreign_keys` is per-connection; the current test opens its own `Database` and enables the pragma itself, so it proves SQLite honors `REFERENCES`, not that `StateStoreImpl` enforces it. Subspec 00 AC 4 claims "an actually enforced parent relationship." Required: the regression fails if the store stops enabling foreign keys — assert it on the store's connection or drive the orphan insert through the store's handle.

3. **Clearing `artifact` and `failureDetail` must be covered.**
   These are the only two fields with a stringify branch on the update path — exactly where clear-vs-omit can break, and where outcome 1 bites. Subspec 01 AC 2 ("clear nullable fields when passed explicit `null`") is currently only exercised on `workflowInvocationId` and `endedAt`. Required: explicit-`null` clear and omitted-field retention proven for both JSON envelope fields.

4. **`v2/docs/state-store.md` must be accurate and complete.**
   - "All fields initialize to `NULL` (status to `'pending'`)" is false of `id`, `pipeline_id`, `stage_id`, `position`; scope the claim to the lifecycle fields.
   - Foreign-key enforcement is now on for the store connection (it also activates `attempts.run_id → runs(id)`). That is a durable, operator-relevant property of the store and must be documented, per subspec 01's documentation requirement.
   - The artifact/failure envelopes are lossless only for JSON-representable values; state that precondition rather than claiming unqualified lossless round-trip.

5. **The "no stored pipeline status" claim must be proven at the schema level.**
   Asserting a missing property on the mapped object can only fail if the row mapper invents a key — it doesn't test the schema. Subspec 00 AC 2 makes a storage claim. Required: assert the `pipelines` table has no status column.

6. **`PipelineRow` must not declare a `definition` key the row does not carry.**
   It is type-correct only because the explicit assignment overwrites the phantom spread; `StageRow` beside it models this correctly with `Omit<...>`. Make it symmetric. Likewise, prefer a real bindings type over the `as never[]` cast on the update path — it is the only such cast in the file.

### Explicitly not required

- **`beforeStageInsert` on the public interface.** This matches the file's existing `beforeRunUpdate` seam on `commitCompletionBoundary` (same shape, same rollback-proof purpose, already mirrored in the `write-loop.test.ts` fake). Changing it is a file-wide convention change, out of scope.
- **Store-level domain errors for duplicate stage IDs or empty pipelines.** Subspec 00's first decision forbids a second validator; the `UNIQUE` constraints are the intended backstop.
- **Distinguishing a stored `null` artifact from a cleared one.** No observable difference exists; nothing is lost.