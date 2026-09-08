Verifying the strongest findings before issuing the verdict.
## Verdict

**Block intent closure until fixed**

1. **`write-loop-binding-source-guard.test.ts` still enforces pre-fix pins on the real tree.** Production assertions require `allowlistPinnedCallerGuard(sources)` and `daemonOnlyBindingSourceMarkerGuard(sources)` to pass on current sources. That reproduces the hardcoded allowlist and `daemon.ts`-only marker red-gates subspec 08 was written to remove. Keep those helpers only as synthetic regression demos; the live oracle must be call-surface discovery plus `locateSymbolSlice` on the resolver owner.

2. **`pipeline-stage-dispatch.test.ts` scan scope overshoots subspec 06.** The decision ledger limits corpus to dispatch-owner modules; implementation scans all daemon production files where `parseStatusWrites` succeeds, pulling in `pipeline-stage-recovery.ts`. That module has terminal `store.updateStage` writes (`failed`, `succeeded`) without `endedAt`, which the new property oracle should reject. Either narrow discovery back to dispatch owners or treat missing `endedAt` in recovery as a production fix — not both ambiguously.

3. **Silent parse exclusion weakens the re-key.** The `catch { return false }` filter drops unparsable files with no signal, contrary to the series’ loud-failure locator intent and able to hide violations or blind spots.

4. **Audit downstream re-key queue is stale.** Inventory rows for 04–08 are `behavioral | n/a`, but the queue still lists them under `re-key`. Refresh per the audit’s own reconciliation rule.

5. **Spec bookkeeping is inconsistent.** `index.md` still routes subspec 03 open though 03 is complete on branch; `intent.md` acceptance criteria unticked; subspecs 06, 07, 08 have acceptance criteria ticked while task checklists stay open. Align before intent closure.

**Fix before claiming subspec acceptance; lower priority for intent closure**

6. **Subspec 06 lacks the pre-fix anti-vacuity pairing** claimed in acceptance prose (no exported map-equality guard or fixture proving failure against `CLASSIFIED_STATUS_WRITES`). Subspecs 04 and 07 similarly omit golden-byte regression exports that sibling subspecs carry.

7. **Subspec 08 suite-gate ticks are unsubstantiated** in this review pass; given item 2, `test:v2` green is not credible until scope/production is resolved and tests are run.

**No actuator change required**

- Lint-contract re-keys (04, 05, 07) match their decision ledgers; lint-only landing and `skipReviewWithoutHarnessMarkdownlint` early-return are accepted tradeoffs.
- Test-local `BINDING_SOURCE_MARKERS`, exported regression helpers from `*.test.ts`, and reuse of `listProductionDaemonSources` are consistent with repo patterns and subspec scope.
- Resume lint assertion on one named case vs broader audit row scope is minor audit-text drift, not a re-key regression against golden bytes.