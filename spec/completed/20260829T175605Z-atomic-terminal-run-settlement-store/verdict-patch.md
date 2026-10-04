Verifying implementation and docs against the spec before issuing the verdict.
## Required outcomes

1. **`v2/docs/state-store.md` must name `commitTerminalRunSettlement` as a `finished_at` stamper everywhere `finished_at` writers are enumerated.** Today the `runs` schema bullet and the “Three durable finish sources” summary list only `setRunStatus` and `commitGuardedKill`, while the API bullet and implementation stamp `finished_at` inside settlement. That contradicts the documented contract and the spec’s documentation-updates requirement for accurate settlement semantics.

2. **`Run.finishedAt` inline documentation must reflect settlement as a terminal finish-metadata writer.** The current JSDoc implies a single non-boundary path; settlement is now another durable terminal writer and should be stated there (per documentation-standard tiering for non-obvious contract facts).

3. **Store tests must prove independent `prNumber` / `prUrl` omitted-vs-null semantics.** The decision ledger and docs treat per-field independence as a material difference from `setPrEvidence`; existing coverage only omits or clears the PR pair together. At least one test must show supplying only one field updates that column while the other pre-existing value remains unchanged.

4. **Store tests must prove invalid `terminalCause` is rejected without mutating the row.** Write-time `isWriteLoopOutcomeKind` validation is specified and implemented but untested; a regression would silently weaken the durable cause contract.

## Not required

- **Admission guards on re-settlement of already-terminal rows** — spec explicitly defers idempotent re-settlement and keeps boundary/guarded-kill predicates in caller layers; unguarded overwrite matches `setRunStatus` and is in scope for this primitive-only slice.
- **Write-time validation or corrupt flags for `terminalFailureDetail` / `terminal_cause` beyond what the AC specify** — corrupt-load for failure detail is covered; cause write validation is the only missing proof (outcome 4).
- **Exporting `CommitTerminalRunSettlementInput`, narrowing `status` at the type level, or breaking the pre-existing persistence↔execution import cycle** — none are acceptance criteria or material spec decisions for this slice.