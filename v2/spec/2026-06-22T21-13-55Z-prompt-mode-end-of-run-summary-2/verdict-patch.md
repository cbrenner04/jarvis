- Make patch filtering strict: a patch summary must select only `mode: "patch"` records. This is the explicit three-way predicate required by subspec 00; prompt rows must never leak into patch summaries.

- Add a meaningful regression test proving a properly namespaced prompt telemetry row is excluded from `runSummary`. The current test is filtered by namespace before mode matching and does not verify the acceptance criterion.

- Add prompt success-path telemetry assertions. For both no-diff and PR success, the persisted JSONL must contain exactly one row with extracted usage and cost fields. This directly guards subspec 01’s enriched-telemetry and write-once requirements.

- Ensure every successful PR path emits an outcome line containing the created PR URL. A successful `gh pr create` must not silently omit the required operator-facing outcome when its captured output is empty or multiline.

- Replace the untyped `Record<string, any>` usage/cost state with the extractor’s typed result. This preserves the repository’s strict TypeScript standard.
