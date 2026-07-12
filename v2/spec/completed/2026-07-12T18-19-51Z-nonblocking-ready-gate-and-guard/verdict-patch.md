- Guard all production `v2/**` and `shared/**` TypeScript sources, including `.tsx`, while preserving equivalent test-file exclusions.

- Make the sync-child-process guard reject bypasses through aliased bindings and bracket/member access for static imports, `require`, and dynamic imports. Its tests must cover those forms. This is necessary for the daemon-never-blocks invariant; the current basic-pattern coverage is insufficient.

- Correct `v2/docs/v1-behaviors.md`: the ready gate is awaited once before flip attempts; only `gh pr ready` is retried up to three times. This must match the implemented finalization ordering and `write-behavior.md`.
