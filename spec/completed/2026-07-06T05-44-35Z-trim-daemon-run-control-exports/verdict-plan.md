## Verdict

### Upheld issues

1. **Missing `## Prerequisites`** — Intent declares seed 01 dependency; subspec omits it. Plan-mode prerequisite gating requires the subspec to echo or explicitly waive (`none`). Seed 01 is landed (`lean-documentation-standard`, `lean-daemon-test-standard` both complete).

2. **Fan-out ordering undocumented** — This slice de-exports daemon/run-control symbols from a broader seed 02 trim surface. Sibling ready-intents exist (`trim-execution-workflow-exports`, etc.). Without a decision line, a later seed 02 wholesale run risks duplicate or conflicting work. `reject-paused-run-resume` also touches `daemon.ts` at a disjoint site; independence should be recorded.

3. **Over-trim boundary unspecified** — Scope bounds listed symbols but does not pin adjacent exports that must stay public (`WorktreeOwnershipRegistry`, `RunOperatorErrorReason`, `RunOperatorNextAction`, `DaemonListRunRow`, `withExternalWorktree`, etc.). A competent implementer could reasonably de-export those too.

4. **Derived-type boundary unspecified** — `run-operator-error` and `daemon-wire` pair const/type exports where only the const arrays are trim targets. De-exporting the derived type aliases would break cross-module consumers (`tui-monitor-types.ts`, `run-control.ts`, tests). Non-obvious without reading sources.

5. **Redundant preservation ACs** — Six named test-file ACs plus full `test:v2` / `test:integration:v2` ACs overlap. Per spec guidance, suite-level pass is the real behavior-preservation contract for a visibility-only trim; the file list adds inconsistency without extra signal.

### Required refinements

1. **Add `## Prerequisites`** echoing intent: seed 01 (`lean-documentation-standard`, `lean-daemon-test-standard`) landed.

2. **Add a decisions entry** stating this spec is the daemon/run-control de-export slice of seed 02 fan-out; seed 02 monolith is superseded for this symbol set; work is independent of `reject-paused-run-resume` (different `daemon.ts` region, behavior change).

3. **Add a decisions entry or AC** that exports not listed in the symbol table remain exported in the five touched modules — rules out over-trimming sibling public API.

4. **Add decisions entries** for derived-type boundaries:
   - `run-operator-error`: de-export `RUN_OPERATOR_ERROR_REASONS` and `RUN_OPERATOR_NEXT_ACTIONS`; keep `RunOperatorErrorReason` and `RunOperatorNextAction` exported — rules out de-exporting the type aliases.
   - `daemon-wire`: de-export step snapshot types; keep `DaemonListRunRow` and other consumer-facing exports — rules out trimming wire types still imported outside the module.

5. **Simplify preservation ACs** to suite-level only (`bun run test:v2` and `bun run test:integration:v2` pass, behavior unchanged by visibility trim) — drop the six named test-file AC.

### Not required

- **`WorkflowPresetName` exemption** — Inert for this slice; optional delete or keep as seed 07 boundary signal.
- **Pre-edit grep AC** — `typecheck` catches import breakage; sufficient for this low-risk trim.
- **Structural symbol-enumeration ACs** — Appropriate for a harness subspec where export visibility is the contract; no barrel re-exports in v2.
- **`v2/docs/` updates** — Visibility-only change with no operator-facing behavior shift; intent and subspec alignment is correct.
- **Title vs `execution/` path** — Intent explicitly lists `external-worktree.ts`; scope is clear.
