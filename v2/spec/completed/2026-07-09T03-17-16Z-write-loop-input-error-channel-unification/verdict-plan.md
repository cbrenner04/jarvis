Verdict: One refinement required.

**Upheld: AC 2 (invalid `--max-iterations` behavior) lacks test backing.**

The spec's Task Checklist changes behavior — it removes the CLI-specific "must be a positive integer" message so invalid `--max-iterations` now falls through to generic `WRITE_USAGE` text. AC 2 asserts this new behavior directly in prose rather than citing an existing test, and per spec-guidance's refactor/preservation-AC rule, that citation form only applies to *unchanged* behavior anyway — this is changed behavior, so it's correctly written in prose form, but changed behavior still needs verification coverage, and none currently exists in the spec (no test in `write-loop-input.test.ts`/`cli.test.ts` is named that covers invalid `--max-iterations` producing exactly the generic usage text with no extra message). Without it, this is an unverified behavior change and a silent-regression risk — a later edit could reintroduce a specific message or drop the usage text entirely with nothing to catch it.

**Required outcome:** Add a Task Checklist item for a test (in `cli.test.ts`, alongside the existing "missing required write args" case) that exercises an invalid `--max-iterations` value and asserts: exit 1, stderr is exactly the generic `usage: jarvis write ...` text, no additional message. AC 2 should reference this test as its verification path.

No other refinements needed — the double-parse removal, `errors`-accumulator removal, scope boundary, and documentation-updates rationale are all sound and consistent with intent and spec guidance.