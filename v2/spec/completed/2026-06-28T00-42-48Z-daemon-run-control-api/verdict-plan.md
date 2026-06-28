## Verdict

**Upheld refinements required:**

**1. Error-case ACs for steering verbs (subspec 02)**
The spec has no acceptance criteria for invalid-run-ID or wrong-state operations on `pause`, `kill`, `resume`. These are the first cases any caller hits. Add at least one AC per verb covering: unknown run ID → rejected; and the key wrong-state case (e.g., `resume` of a terminal `completed`/`failed`/`blocked` run → rejected).

**2. Preservation AC must cite test anchor (subspec 00)**
"The abort (`signal`) path is unchanged" is a preservation claim. Per spec guidance, preservation ACs must cite the anchoring test rather than paraphrase behavior. Rewrite to cite the test file that covers abort behavior (e.g., `write-loop.test.ts`).

**3. `WriteLoopOutcomeKind` extension not stated (subspec 00)**
The AC requires a loop result distinguishable from `budget-exhausted`, but the spec never states that `"paused"` is added to `WriteLoopOutcomeKind`. Since both `paused` and `budget-exhausted` are `resumable: true`, `kind` is the only distinguisher. Add an explicit decision that `WriteLoopOutcomeKind` gains a `"paused"` variant.

**4. Kill write-after-abort ownership rule missing (subspec 02)**
When `kill` fires the abort signal mid-step, the loop's in-flight `executeWrite` may still complete and attempt a boundary commit. The daemon simultaneously writes `killed` status. The spec correctly claims the daemon is the sole writer of `killed`, but doesn't state what the loop does in this window. The spec must state: if the loop observes the signal aborted when a step returns, it skips the boundary commit; daemon is sole writer of `killed`.

**5. `resume` input reconstruction not in task checklist (subspec 02)**
`resume` receives a run ID; `executeWriteLoop` takes `WriteLoopInput` (project, branch, worktree, spec path). The task checklist must call out that the daemon loads the durable run row by ID to reconstruct `WriteLoopInput` before re-invoking the loop.

**6. Tail error cases have no ACs (subspec 03)**
No acceptance criterion covers: (a) tail requested for a nonexistent run ID, or (b) tail of a completed run that has no more appends coming. The current description says "until the log is exhausted" but this is untested by any AC. Add ACs for both cases.

**7. `stream-open` run ID field needs pinning (subspec 03)**
Wire encoding is deferred, but the tail handler must parse *something* from `stream-open` to know which run to serve. This specific field is not covered by the deferral of the general encoding scheme — without it the handler can't be written. Pin how the run ID is carried in the `stream-open` payload (a specific field name and type, even if the rest of the encoding is deferred).

**8. "Settled" undefined (subspec 01)**
The term "settled" appears in an AC ("a run that has settled is no longer reported as live by `list`") with no definition. This creates ambiguity for `paused` runs where the loop Promise has resolved but the run is not terminal. Define "settled" as "the loop's Promise has resolved, regardless of outcome kind."

**9. Cross-subspec registry extension not flagged (subspec 01)**
Subspec 01 defines the in-memory run registry type. Subspec 02 must extend it with a pause mechanism without the implementer knowing to expect this. Add a note in subspec 01 that the registry type is open to extension in subspec 02, preventing it from being defined as a sealed/final struct.

**10. Echo-handler tests not addressed (subspec 03)**
Subspec 03 replaces the existing echo behavior in `ipc/server.ts` but says nothing about the echo tests. The task checklist should note that the echo test is superseded and deleted or adapted.

**11. IPC test names vs. deferred external names (subspecs 01–03)**
The intent defers external IPC method names to the CLI as first external caller, but in-process tests must use *some* names. The spec should clarify that in-process tests may use working names chosen by the implementer; the stable external names are pinned when the CLI subspec arrives.

---

**Not required:**
- Run ID format (Finding 2): already determined by state store UUID generation — non-decision.
- `pauseSignal` "e.g." wording (Finding 5): decisions section is binding; checklist is guidance — not a defect.