Verifying parser wiring against the parity guard before issuing the verdict.
## Adjudicator verdict: help-lists-registered-flags

### Required outcomes

1. **Single authoritative flag surface for `cleanup`, `run list`, and `daemon log` (subspec `01`)**  
   For each of these paths, the set of argv tokens the live parser accepts must be the same definition the parity guard uses—same pattern as `WRITE_PARSE_ARG_OPTIONS` / `parseWriteArgs` and `*_WORKFLOW_PARSE_OPTIONS` / workflow parsers. Today `CLEANUP_PARSER_FLAG_TOKENS`, `RUN_LIST_PARSER_FLAG_TOKENS`, and `DAEMON_LOG_PARSER_FLAG_TOKENS` are only referenced by `help-flags-parity.ts`, while `parseCleanupCliArgs`, `parseListArgv`, and `daemon log` still branch on inline literals. A new parser-only flag can ship with correct runtime behavior, stale help, and a green `helpFlagsParityGaps()`. **Outcome:** after the fix, extending accepted flags for any guarded hand-rolled path requires one shared definition that both the parser and parity consume, so parser→help drift is mechanically blocked.

2. **Parity inversion tests match subspec `01` acceptance criteria**  
   `01` requires that gaming the guard fails—for example, treating the parser as accepting fewer flags than it really does while help still lists them (or the converse modeled correctly). **Outcomes:**  
   - The “dropped help flag” case must use the real write parser option keys (e.g. `WRITE_PARSE_ARG_OPTIONS` / `helpPathParserParityGaps(["write"])`), not `WRITE_HELP_FLAGS` names standing in for the parser.  
   - At least one test must show that when the **parser-side** set used by parity is incomplete relative to what the wired parser accepts, `helpFlagsParityGaps()` is non-empty (or the main parity test fails). The test named around “excluding a parser flag from the comparison set” must not only remove a flag from registered help metadata; that exercises help drops, not a stale parser assertion set.

3. **Keep scope boundaries (no new actuator work)**  
   Reverse parity (help lists flags the parser rejects), renaming `command-help-flags.ts` / execution imports, deduplicating `usage:` vs flag order, and updating parent `intent.md` checkboxes are **not** required to close this patch. Docs for flag line format and `v1-behaviors` help behavior are sufficient for the delivered slice.

### Rationale

Subspec `01` explicitly rejects a third hand-maintained flag list and requires one option set per path **shared by parser and guard**. Write, `run start`, and workflow presets meet that; cleanup, `run list`, and `daemon log` do not, which undermines intent AC #3 (“a test fails when a flag accepted by a command's parser is missing from that command's help output”) for those commands. Strengthening parity tests ensures the inversion acceptance criterion is actually enforced and not satisfied by help-only assertions that never touch the parser surface.

Everything else in the branch (tree `flags`, tab-separated help lines, write/workflow parse-option extraction, CLI help regressions, `write-behavior.md` / `v1-behaviors.md`) aligns with subspecs `00` and `01` once outcomes 1–2 are met.