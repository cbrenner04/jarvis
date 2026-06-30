## Verdict — required refinements

### 1. Reconcile structured-log-stream deferral (00)
**Outcome:** 00 `Documentation updates` must retract or update the cross-process `follow` wake deferral in `v2/spec/completed/2026-06-27T22-15-55Z-structured-log-stream/00-log-stream.md` (L46–48), per intent and single-home policy in `v2/docs/documentation-standard.md`.  
**Rationale:** Intent explicitly requires this; 00 currently only names `v2-architecture.md`, leaving the completed spec contradicting shipped behavior.

### 2. Resolve poll prohibition vs deferred fallback (00)
**Outcome:** One decision must state production blocking is event-driven on shared-storage append (not fixed-period polling), and align the deferred-OS-primitive line so it does not authorize a poll-interval fallback that contradicts the poll ban. Pin when (if ever) a non-periodic fallback is legal, or drop fallback language.  
**Rationale:** Current 00 bans the 100ms loop while deferring “poll interval fallback”; implementers could satisfy both by re-labeling polling.

### 3. Preservation ACs cite pinning tests (00)
**Outcome:** Replace paraphrased behavior-preservation ACs with citation form per spec guidance — e.g. `log-stream.test.ts` `"follow yields existing events from seq 1, then new appends in order"` stays green — and drop redundant paraphrases covered by those citations or a single file-level “stays green” AC.  
**Rationale:** Paraphrase risks false contracts; the named test already covers post-close live append in-process.

### 4. AC for wake-wait DI seam (00)
**Outcome:** Add an acceptance criterion that agent-runnable `follow` tests coordinate via an injected wait seam with no wall-clock dependence (`v2/docs/test-writing.md`).  
**Rationale:** Decision and task require the seam; without an AC it is unenforced.

### 5. Align verification commands with agent slice (00, 01)
**Outcome:** Agent-runnable gates should say `bun run test:v2` (and `bun run typecheck`); cross-process proof should be tied to `test:integration:v2` / `*.sandbox-unrunnable.test.ts` per `v2/docs/test-writing.md`.  
**Rationale:** Patch agents run `test:v2`; `bun run test` alone misstates what the slice must pass in sandbox.

### 6. Surface prerequisites in 00
**Outcome:** Move intent prerequisites into 00 (dedicated section or decisions): existing `follow`/`tail` contracts, injectable storage, daemon IPC tail backed by `follow`.  
**Rationale:** Single-subspec readers should not depend on `intent.md` for blocking context.

### 7. Clarify 00 cross-process proof shape (00)
**Outcome:** Decision that 00 proves detached reader + separate-process writer on shared injectable storage; daemon-as-writer is not required in 00 (01 carries wire proof). Optionally soften intent “daemon writer” to match.  
**Rationale:** Intent and 00 currently read as different proof scenarios; layering is sound but needs explicit alignment.

### 8. Pin wake scope (00)
**Outcome:** One decision: wake is storage-artifact scoped; `runId` filtering stays reader-side via existing `tail()` — rules out per-run OS signals in this slice.  
**Rationale:** Shared single-file storage makes cross-run wake plausible; filtering behavior should be explicit so implementers do not invent per-run IPC.

### 9. Tighten 01 to real daemon tail handler (01)
**Outcome:** 01 must not rely on “or equivalent” inline `StreamHandler` copies. Either (a) declare a prerequisite that the exported tail-stream handler factory from `daemon.ts` exists (ready-intent `daemon-tail-stream-handler-factory`), or (b) include factory export in 01 scope. Sandbox-unrunnable IPC proof must wire that factory with injected fakes; preservation ACs must anchor on tests that exercise real handler gating, not mock handlers that use `tail()` instead of `loadRun` + `follow`.  
**Rationale:** `ipc.test.ts` tail tests today duplicate handler logic; citing them does not pin `daemon.ts` behavior. `tailStreamHandler` is still closure-local, not exported.

### 10. Substantive architecture documentation (00)
**Outcome:** `v2/docs/v2-architecture.md` Observability update must state cross-process `follow` wake is settled (append-driven notification, detached readers receive live appends, IPC tail inherits via `follow`), not a hollow “settled” label; mechanism detail pinned when implementation chooses primitive.  
**Rationale:** Intent and 00 docs obligation; architecture section today describes blocking without cross-process wake.

### 11. Optional but recommended (non-blocking if omitted)
- **01 disconnect preservation:** AC claims `stream-end` or disconnect aborts `follow`; only stream-end is cited — cite a disconnect test or narrow the AC.  
- **Inherited single-writer:** 00 decision citing parent single-writer-per-`runId` assumption for sandbox proof.  
- **Sandbox AC phrasing:** Lead with behavior, filename as verification anchor per harness spec convention.

---

**Merge posture:** Core split (00 library wake, 01 IPC inheritance), sandbox-unrunnable strategy, and scope boundaries are sound. Refinements 1–10 are required before merge; item 11 is polish.
