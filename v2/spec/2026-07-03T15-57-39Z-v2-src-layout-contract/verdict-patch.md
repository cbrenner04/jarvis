## Verdict — required outcomes

### 1. Import matrix must match committed persistence ↔ execution edges

**Source layout** states persistence may import `shared/` only, with a single committed exception (`state-store.ts` → `invocation-failure.ts`). Committed code also has `log-stream.ts` type-importing `WriteLoopOutcomeKind` from `write-loop.ts`. Together these form a mutual type-only dependency: execution → persistence (`write-loop.ts` → `log-stream.ts`) is allowed; persistence → execution has two edges, not one.

**Required:** The import matrix and committed-exception block must account for every persistence → execution type import in today's graph, characterize the mutual typing between `log-stream` and `write-loop`, and keep the existing break-on-relocation policy (hoist to `shared/` or colocate; no silent value imports). After the fix, a reader can treat **Source layout** as authoritative for relocation and Biome follow-on work without hitting a surprise second exception.

**Rationale:** AC₁ requires import rules that match the spec matrix; the spec pins structure-as-contract that must be verifiable against committed code. A matrix that forbids what code already does is a false contract and will mislead the first relocation or enforcement subspec.
