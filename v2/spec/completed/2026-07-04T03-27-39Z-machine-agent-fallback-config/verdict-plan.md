## Verdict

**1. Fix the precedence/error contradiction (most important).**
The spec currently requires an invalid machine config to always produce a hard CLI error (AC4), but the intent's own precedence rule says `--agents` overrides machine config entirely. Combined, this means a broken machine config could break a run even when the operator supplied `--agents` and never needed the config at all — contradicting "CLI override as a per-run bypass" in the intent. Subspec 01 must state that the machine config is only loaded/validated when `--agents` is absent, and AC3/AC4 must be reconciled with that: `--agents` runs never fail due to machine-config content, regardless of validity.

**2. Confirm, don't assume, that `run start` shares the write-agent resolution path.**
Subspec 01 asserts `run start` goes through `buildWriteLoopInputFromCliValues` without this being checked against a prerequisite. Per spec-guidance's intent-prerequisite gate, add a `## Prerequisites` line naming this integration fact so drafting confirms it against `cli.ts` before the spec relies on it. If it can't be confirmed, narrow subspec 01's scope to `jarvis write` only rather than asserting `run start` behavior.

**3. Pin down comparison/validation edge cases for the `agents` list.**
The loader's invalid-shape rules (duplicate name, non-string entry, empty array) need two more explicit decisions so tests aren't left guessing: (a) duplicate detection is exact-string comparison, no trimming or case-folding, and (b) an empty-string entry is invalid independent of the empty-array check. Add these as one-line decision bullets in subspec 00.

**4. State order preservation as an explicit decision.**
Since array order *is* the fallback-priority semantics, subspec 00 should explicitly say the loader returns `agents` in on-disk order, unmodified — not leave this implied.

**5. Add an AC for the new parameter's own default.**
Alongside the "existing tests stay green" refactor-citation AC, subspec 01 needs a one-line AC/test-checklist item asserting that omitting the fallback parameter defaults to `DEFAULT_WRITE_AGENTS` — this is new behavior on the parameter itself, not covered by the preservation citation.

No other changes required — the documentation target (`v2/docs/agent-model-config.md`) is correctly scoped and structural ACs are appropriately harness-flavored.