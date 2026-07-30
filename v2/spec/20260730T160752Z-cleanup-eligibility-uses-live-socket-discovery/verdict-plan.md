# Verdict: Required refinements

The core slice is sound: bulk cleanup eligibility should query the same live-socket set as `jarvis run list`, union `isLive` across sockets, and keep `--abandon` keyed-only. The gaps are verification and operator-visible edge cases at the CLI boundary, not the central behavior. Refine before merge.

---

## 1. CLI stderr gate needs an acceptance outcome

**Required:** An acceptance criterion that when the invoking digest socket has no listener but a discovered older-digest socket answers, bulk cleanup does **not** emit the "continuing without daemon" stderr, and a live run on that socket blocks the worktree.

**Rationale:** The no-listener stderr decision is CLI-only; the primary regression test injects `DaemonClient` directly and can pass while stderr stays wrong. This is the main ship-risk the advocate identified.

---

## 2. Define invoking-socket hard-error behavior when discovery finds a healthy socket

**Required:** An explicit decision on whether non-`ENOENT`/`ECONNREFUSED` errors on the invoking socket abort the command when another socket in the query set would answer — aligned with `run list` (probe all, skip failures) or preserving today's CLI abort.

**Rationale:** The spec rules in the no-listener path but leaves a real fork on `EACCES`, timeout, etc. Implementers will guess without a ruled-in/out choice.

---

## 3. Define "answering daemon" for the stderr gate

**Required:** A decision that a socket counts as answering only when connect + `list` + parse succeed (same semantics as `run list`), so partial failures do not suppress or trigger the no-listener message incorrectly.

**Rationale:** The stderr gate depends on this definition; without it the gate is ambiguous when connect succeeds but `list`/parse fails.

---

## 4. Recheck must inherit multi-socket semantics explicitly

**Required:** A decision that preview and recheck share the same multi-socket union client; per-socket skip-on-failure applies on recheck; exit nonzero only when **no** socket answers on recheck.

**Rationale:** Behavior is mostly implied by shared `daemonClient`, but recheck is a distinct operator path with existing preservation tests. An explicit decision prevents divergent recheck wiring.

---

## 5. Per-socket skip-on-failure needs a verifiable outcome

**Required:** An acceptance criterion (or named test citation) that one dead socket in the query set does not blank eligibility when another socket reports a live run for the same `(project, branch)`.

**Rationale:** The decision is stated but not tied to verification. `run list` has a parallel "unreachable socket skipped" AC; cleanup should match that pattern.

---

## 6. Preservation ACs must cite pinning tests

**Required:** Rewrite the matching-key-only preservation criterion to cite existing tests by name/path (e.g. recheck-unreachable, malformed-list, daemon-throw tests in `cleanup.test.ts`), not paraphrase "stay green without behavior change."

**Rationale:** Spec guidance requires refactor/preservation ACs to anchor on tests; paraphrasing risks false claims.

---

## 7. Guard-inversion AC must bind test to guard hook

**Required:** The guard-inversion acceptance criterion must name the production test hook (e.g. `setInvertCleanupSocketDiscoveryForTest` or equivalent) and state that inverting the socket-union guard turns `older-digest live daemon makes merged worktree ineligible` RED; if a separate skip-on-failure guard exists, name it and its inversion test too.

**Rationale:** Repo convention and the completed `run list` spec require guard-inversion ACs to name both the guard and the test; naming only the test is under-specified.

---

## 8. Update or split the existing CLI no-listener preservation test

**Required:** Account for `cleanup-cli.test.ts` `continues cleanup when keyed socket has no listener` — either as an updated preservation citation (after adapting for the new stderr gate) or as two distinct outcomes: true no-listener vs discovered-answering.

**Rationale:** That test will change when discovery answers; citing it unchanged would be a false preservation anchor.

---

## 9. Clarify intent ↔ subspec scope on claim probes

**Required:** Align intent wording with the subspec: this slice covers bulk cleanup `list`-based eligibility only; `checkWorkflowStartClaim` paths (`--abandon`, stale reset) remain keyed-only, deferred to a later consumer.

**Rationale:** Intent says "eligibility and live-run checks" broadly; the subspec correctly narrows scope. Drift will confuse implementers and reviewers.

---

## 10. Optional but recommended: head-only ref prune and operator-runbook

- **Ref prune:** Cite `head-only daemon-unreachable skip exits nonzero` as preservation, or add a sibling regression that an older-digest live run skips head-only ref prune with "daemon reports live run" (not required if shared factory is explicit in decisions).
- **Operator-runbook:** A lightweight AC that the interim cross-digest gap note is removed and multi-socket eligibility is documented — optional per repo norms, but high value given operator-visible symptom.

---

## Not required

- Splitting into multiple subspecs — one atomic subspec is appropriate; surfaces are coupled.
- AC for `queryDaemonListsFromSockets` extraction vs inline reuse — implementation freedom, not operator-visible.
- AC for `--abandon` keyed-only — scope decision + docs task suffices.
- Stale superseded daemon reporting live — out of scope; union fail-closed is correct.
- Prerequisite line in subspec — helpful but not blocking; prerequisite is merged on `main`.

---

## Summary

Refine the spec with **seven required outcomes** (items 1–7) and **two strongly recommended** (items 8–9). Item 10 is optional. No structural split needed. After refinement, the spec will have operator-visible CLI coverage, explicit edge-case decisions aligned with `run list`, and acceptance criteria that meet spec guidance on preservation citations and guard inversion.