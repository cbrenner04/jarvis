## Verdict: refine before merge

Direction and scope align with intent and prerequisites. The draft leaves several **observable contracts implicit** where the merged TUI scaffold already pins conflicting behavior. Refine to resolve supersession and pin operator/test contracts the implementer cannot infer.

---

### Required refinements

**1. Scaffold supersession and liveness sequence**

- Record an explicit decision that launch supersedes scaffold 01’s connect-only exit contract and extends the 00 client with `start`.
- Pin whether `health`/`status` still run on the success path and where in the flow (before field collection, after connect only, or dropped).
- Pin the full success-path ordering: connect → (liveness per decision) → collect launch fields → `start` → operator feedback → exit `0`.
- **Why:** Scaffold ACs, `write-behavior.md`, and `tui-entry.test.tsx` currently require `health`/`status` then exit `0` with no run-control RPCs. Launch changes that behavior without stating retention vs removal.

**2. Operator feedback channel and view state**

- Record that success, admission-guard, and pre-`start` validation feedback render through the ink view host (same channel as scaffold), not stderr/stdout parity with `jarvis run start`.
- Extend the view-state contract beyond `connected | unavailable` to cover launch outcomes (success with run ID, guard failure, validation failure); exact copy/layout remain deferred.
- Pin that operator-visible success is the returned run ID via view host; label/format and stdout scripting parity are out of scope.
- **Why:** `<code>: <message>` pins format but not sink; scaffold already established ink + `TuiViewHost` as the operator contract.

**3. Field collection vs deferred UX**

- Record field collection via ink (scaffold stack); rules out readline/stdout prompts.
- Add a behavioral AC that `jarvis tui` produces the same `WriteLoopInput` as `jarvis run start` for a fixed fixture (including defaults when optional flags omitted), verifiable through an injectable collector or shared builder seam.
- Clarify whether shared extraction from CLI is required in this slice or optional “when practical,” and if required, name the extraction outcome (shared builder module or equivalent parity guarantee).
- **Why:** “Collects the same required launch fields” conflicts with deferred layout/defaults unless mapping parity is test-anchored; “when practical” is not verifiable without a decision or AC.

**4. Pre-`start` validation and RPC error edges**

- Pin that missing/invalid required fields exit `1`, do not send `start`, and show operator-visible errors through the same feedback channel as guards; exact copy deferred.
- Add a launch-flow AC for generic non-guard `TuiDaemonRpcError` on `start` → `<code>: <message>`, exit `1` (same pass-through pattern as guards).
- If liveness stays on the path: pin behavior when `health`/`status` fail after connect (propagate vs operator-visible `<code>: <message>` + exit `1`).
- Pin behavior for `TuiDaemonConnectionError` mid-flow (e.g. during `start`): reuse unavailable-daemon scaffold feedback + exit `1`, or a distinct “connection lost” message — pick one.
- **Why:** Intent highlights admission guards; `jarvis run start` already exits `1` on field errors before RPC. Unavailable-daemon AC covers connect-time only.

**5. Test supersession**

- Add a preservation/supersession AC citing `tui-entry.test.tsx` (or its successor) with updated expectations for launch flow — not only `cli.test.ts` green.
- If liveness is retained: add matching launch-flow AC; if dropped, remove liveness from the client-RPC-surface decision and do not assert liveness in launch tests.
- Add AC that new exported `TuiDaemonClient.start` has inline doc-comments per `documentation-standard.md` (mirror scaffold 00).
- **Why:** Launch necessarily breaks scaffold’s “invokes only `health` and `status`” test contract; citing the test avoids paraphrase drift per spec guidance.

**6. Documentation updates**

- Change doc tasks from “extend” to **revise** the `jarvis tui` row in `write-behavior.md` for launch outcomes (field contract, run ID on success, guard/validation errors, exit codes).
- Update `v2-architecture.md` shipped TUI bullet to reflect launch via IPC `start`; liveness wording must match the liveness decision in refinement 1.
- Add `daemon-host.md` to Documentation updates as a cross-link for `start` RPC use (scaffold pattern).
- **Why:** Current durable docs describe connect-only `jarvis tui`; launch replaces that operator contract.

---

### Not required

- Explicit `bun run typecheck` AC (repo harness default suffices).
- Enumerating every `WriteLoopInput` constant in decisions (fixture parity AC is enough).
- Splitting the subspec unless shared extraction scope grows beyond one reviewable change.
- `v1-behaviors.md` update (net-new v2 surface).

---

### Summary

**Approve direction; block merge until refined.** The spec must explicitly supersede scaffold connect-only behavior, pin session ordering and feedback channel, anchor `WriteLoopInput` parity and test supersession, and cover validation plus non-guard RPC/connection failure edges. Documentation tasks must reflect revision of the existing TUI operator contract, not extension of a connect-only row.
