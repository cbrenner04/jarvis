## Verdict — Refinement required

The draft's state-store columns (`00`) and write-loop budget/outcome routing (`01`) are sound and the per-invocation-budget / artifact-existence-contract decisions are correctly defended. The gaps cluster in the resume subspec (`02`) and the status enum in `00`. The following refinements are required.

### Load-bearing — must pin

1. **Resume lookup key.** `02` says "load an existing run for the run identity" but never defines that identity, and the CLI surface (`--project/--branch/--spec/--artifact`) carries no run ID. The architecture already pins "at most one active run per (project, branch)," so resume must key off the `(project, branch)` tuple. Name this as an explicit decision and add acceptance criteria: same key resumes the existing run; a different key creates a fresh run. Without this, "resumable" is unspecified.

2. **Three-way terminal branch on resume.** `02`'s branch is binary (interrupted vs. completed-at-boundary → "continue with fresh budget"). But a `blocked`, `contract_miss`, or `invocation_failure` run also committed its final boundary and would read as "completed-at-boundary," causing a wrongful re-run of an already-terminal run. Refine to a three-way decision: terminal-done (success / blocked / contract_miss / invocation_failure) → report and do **not** resume; interrupted (open attempt, no committed boundary) → re-run the iteration over the dirty worktree; soft-stop → continue with a fresh budget. Add the terminal-run-not-resumed acceptance criterion.

3. **Status enum must name every terminal outcome the loop produces.** `00`'s enum has no home for terminal `contract_miss` or `invocation_failure`, yet the terminal-done branch (#2) reads exactly this column. Extend the enum so each terminal outcome `01` can emit is representable (e.g. fold `contract_miss` into a blocked status since it appends a `## Blocker`; give `invocation_failure` a failed status). Fix `00` and `01` together so the produced statuses and the stored enum agree.

### Consistency / smaller — must address

4. **`invalid_token` routing.** `runStep` can return `invalid_token`; `01` never routes it. Settle it explicitly as terminal failure (a malformed agent response is not `progress`), consistent with `invocation_failure`.

5. **`interrupted`: stored vs. derived — reconcile.** `00` lists `interrupted` in the status enum while `02` derives interrupted-ness from attempt history and leaves "column vs. derived" open. These conflict. Pick one: if interrupted-ness is a read over attempt history (open attempt row), drop `interrupted` from the stored *status* enum (run status stays in-progress). State the choice in both files.

6. **Resume vs. live-run guard.** An interrupted run and a currently-live run are indistinguishable from attempt rows alone ("attempt started, no boundary"). The discriminator already exists — `withExternalWorktree` refuses a live lock holder and only recovers a stale lock — but `02` leaves it implicit. State that resume is gated on the worktree lock (live holder → refuse, not recover) and add an acceptance criterion so the safety is explicit rather than incidental.

7. **Boundary idempotency key.** `00` asserts the completion boundary is idempotent but never says what makes it so. Name the key the idempotency rests on (the attempt ID's committed terminal status), so the idempotency claim — and `02`'s finished-boundary-retry test — is testable rather than asserted.

8. **Blocker-append idempotency across resume.** Add an acceptance criterion that a resumed run does not re-append `## Blocker`. This follows from #2 (a terminal `contract_miss` run is not re-run) but should be locked in explicitly.

9. **Soft-stop exit code.** Four terminal failures collapsing into "distinct non-zero" has multiple defensible mappings. There is one parity anchor: v1's exit `5` = max-iterations soft-stop. Pin soft-stop = 5; the remaining failures may stay "distinct non-zero" as genuine defaults.

### No action

Run-ID/created-at minting is internal once the resume key is pinned (#1) — leave to the implementer. The "checkpoint = terminal status + attempt count" redefinition is already documented and correct; at most a wording note in `state-store.md`, not a defect.

Rationale: these refinements close the gap between "resumable" as claimed and as specified — the resume key and the terminal-vs-resumable branch are the contract this phase exists to prove (intent: "first v2 consumer that must resume"). The status enum and idempotency key are the durable reads that branch depends on; leaving them implicit makes the acceptance tests un-anchored.