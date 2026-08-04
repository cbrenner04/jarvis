## Verdict: required refinements

### 1. Pin deferred persistence semantics before subspec 01 can ship

Subspec 00 defers claim-holder identity and release timing to subspec 01. Subspec 01 must **decide and state** (not leave implicit):

- Whether `release` is keyed only by `(pipelineId, stageId, branchKey)` or requires holder identity.
- When `release` runs relative to partition completion — specifically that release aligns with settlement or existing live-entry early-exit paths, **not** when `dispatch(steps)` returns while `wait()` is still outstanding.

Include an explicit task in 01 to resolve 00’s deferred semantics so 00 cannot land an API 01 cannot use.

**Rationale:** Intent requires claim-before-dispatch; releasing too early reopens the cross-continuation race while the winner’s entry run is live.

---

### 2. Define crash/restart behavior for held admission rows

The spec does not define what happens when a winner holds `pipeline_stage_admission` but crashes or the daemon restarts before release. Intent cites cross-process races; the concurrent-continuation AC only models same-process overlap.

Pick one and state it explicitly:

- **In scope:** Orphan rows are reconciled (e.g. continuation claim, startup sweep, or short-lived lock semantics with a defined recovery path).
- **Out of scope:** Document that restart may leave stale admission rows and what operator intervention is expected.

**Rationale:** “Durable” claims imply restart/cross-process safety; an undefined orphan path can block dispatch indefinitely or contradict the intent.

---

### 3. Single claim site and partition boundaries

Replace ambiguous “partition time” prose with an explicit decision:

- One durable claim site: inside `dispatchPipelineStage` (linear and fan-out paths converge there).
- No double acquisition on the linear path.
- Claim precedes the `dispatch(steps)` callback; release follows partition completion (settlement or live-entry early exit), not dispatch return alone.

**Rationale:** “Partition” is not a codebase symbol; implementers need a single wiring point and correct hold duration.

---

### 4. Lost-claim continuation behavior

On refused claim, the spec forbids dispatch and `failed`, but does not tie the loser to adopt vs stop. Add a decision:

- Re-read the stage row.
- If `running` with live `workflowInvocationId`, adopt via the existing adopt path.
- Otherwise return without `failWorkflowStageAt` / `skipRemainingStages` for that row.

**Rationale:** Early return from `dispatchPipelineStage` without this tie can leave a still-`pending` row mis-handled in `advanceWorkflowStage`.

---

### 5. Two-layer claim ordering

State explicitly:

- Durable admission in `dispatchPipelineStage` for cross-continuation coordination.
- In-memory `dispatchClaims` retained for within-run fan-out sibling coordination.
- No durable claim in fan-out resolution/adopt paths that would duplicate or invert ordering.

**Rationale:** Code already documents in-memory claims as “stage-admission”; layering must be unambiguous to avoid wrong claim order or redundant durable claims.

---

### 6. `@mutate` target for refused-claim guard

Subspec 01 requires a mutation checkpoint but does not name the guard. Specify the expected site (refused-claim early return in `dispatchPipelineStage` or its wrapper, not `advanceWorkflowStage` catch/resolution paths) so the harness can apply and verify the directive.

**Rationale:** Spec guidance requires a linked, uniquely-occurring `@mutate` directive; wrong placement yields refused or inert checkpoints.

---

### 7. Bound the unreachable-guard audit

Cap the audit to guards that assumed cross-continuation dedup via stage-row re-read alone and wrote `failed` when another continuation owned dispatch. Require either deletion of proven-dead guards or an exported tested predicate with both truth directions — not an open-ended audit across dispatch paths.

**Rationale:** Intent requires dead guards be deleted or proven unreachable; an unbounded audit invites scope creep and stray `@mutate` targets.

---

### 8. Acceptance-gate subspec 00 documentation

Subspec 00 lists `v2/docs/state-store.md` updates but has no matching acceptance criterion. Add an AC that docs document the durable admission claim contract (absent vs refused, claim/release/load semantics), or include `lint:md` in 00’s gate bundle.

**Rationale:** Docs are part of the work; without an AC they can be skipped while 00 completes.

---

### 9. Documentation naming for durable vs in-memory claims

Doc tasks must require explicit naming: durable `pipeline_stage_admission` vs in-memory `dispatchClaims`, in `state-store.md`, `daemon-host.md`, and `v1-behaviors.md`.

**Rationale:** Terminology collision exists in current code comments; operators and implementers need distinct names for two layers.

---

### 10. Strengthen subspec 00 test contract

- Add explicit “new tests fail against baseline before implementation” phrasing to 00’s first AC (align with spec guidance for runtime-behavior subspecs).
- Add a `state-store.test.ts` concurrent-claim test using separate store instances against real SQL (`storeA`/`storeB` pattern), not only in-process contention — to prove cross-process/cross-connection claim safety at the persistence layer.

**Rationale:** Intent emphasizes durable, cross-process safety; SQL-layer proof should not rely only on fake stores.

---

### 11. Clarify `load()` role in dispatch path (minor)

Subspec 00 defines three methods; 01 wiring tasks mention claim/release only. State whether the execution layer calls `load()` on the dispatch path or relies on claim outcome plus stage-row re-read.

**Rationale:** Avoids implementer ambiguity without mandating unnecessary calls.

---

### 12. Subspec 00 prerequisite for fan-out APIs (if needed)

If subspec 00’s test doubles or compile-time store completeness work touches branch-scoped artifact or fan-out-related `StateStore` surfaces, add fan-out as an explicit prerequisite in 00 (as 01 already does). If 00’s surface is strictly admission table + three methods, no change.

**Rationale:** Prerequisite ordering should match actual compile/test dependencies per subspec boundary.

---

### Not required (upheld as sufficient)

- Combined fan-out + cross-continuation regression (composition of separate ACs is enough for the stated failure mode).
- Minimal linear/`default` branchKey concurrent-continuation fixture (matches documented root cause).
- Subspec 01 bundling of wiring, regression, bounded guard audit, doubles, preservation ACs, and full gates (acceptable if guard audit is bounded per item 7).
- Intent vs subspec AC rollup and structure-first harness ACs.
- Migration number `022` — implementer should take next id from `SCHEMA_MIGRATIONS` at implementation time.