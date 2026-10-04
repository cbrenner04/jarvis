Reviewing key implementation areas against the spec to validate upheld findings before issuing the verdict.
## Verdict — required outcomes

### 1. Spec-tree allowed paths must cover the full spec directory for non-index `specPath`

**Outcome:** Allowed-path derivation for gate classification must treat every markdown file in the spec directory containing the active `specPath` as in-scope, not only the single routed subspec file.

**Why:** Subspec 01 defines the allowed set as the union of base-to-HEAD changes, untracked files, and **spec-tree files**. When `specPath` is a direct subspec (not `index.md`), current logic allows only that one file. A red test in a sibling subspec in the same spec directory can be misclassified as `ready_gate_out_of_scope`.

**Proof required:** A test where `specPath` points at a direct subspec, a sibling subspec file is not in the git diff, and a terminal failure attributed to a path under that sibling stays `ready_gate_failed` (or is otherwise not out-of-scope). Inverting full-directory enumeration must turn the test red.

---

### 2. CLI outcome mirrors need parity coverage for `ready_gate_out_of_scope`

**Outcome:** Every CLI/status mirror that already covers `ready_gate_failed` must symmetrically cover `ready_gate_out_of_scope`, including the new evidence fields where applicable:

- `commands/write.test.ts` — stdout JSON projects `readyGateOutsidePaths` and `readyGateOutOfScopeDetail`
- `commands/run.test.ts` — wait/exit behavior for the new failed, resumable kind
- `commands/workflow.test.ts` — resumable outcome lineage includes the new reason

**Why:** Subspec 03 requires the reason in **every affected outcome mirror, recovery set, and CLI exit projection**. Core daemon/workflow paths are covered; these command-layer mirrors are wired (`write.ts`, `run-completion.ts`) but untested. Guard inversions on field propagation must turn the new tests red.

---

### 3. `daemon-host.md` must match actual list/wait evidence for gate failures

**Outcome:** The durable contract must not claim `error.publicationFailure` is populated for `ready_gate_failed` or `ready_gate_out_of_scope` on `list`/`wait` unless the implementation actually projects it. Document the real operator-visible fields: `readyGateError` message, and for out-of-scope, `readyGateOutsidePaths` and `readyGateOutOfScopeDetail` with retry-finalization recovery.

**Why:** Subspec 03 updates `daemon-host.md` as the durable operator contract. The current text overstates gate-failure projection; `composeRunOperatorError` does not forward `publicationFailure` for gate failures. Misdocumented contracts mislead operators at resume time.

---

### Not required for this pass

- **v1/shared-only scoped gates without failing-file records:** Subspec 00 scopes emission to `run-v2-tests.ts`; incomplete evidence correctly falls back to `ready_gate_failed`. No change unless a future spec extends emission.
- **Test helpers exported from `*.test.ts`:** Hygiene only; no behavioral gap.
- **End-to-end subprocess test through real `bun run ready`:** Reasonable hardening; not required by checked acceptance criteria.
- **`intent.md` unchecked rollup:** Harness bookkeeping; subspec ACs are satisfied.
- **Resume helper naming / hidden-shrink resume regressions:** Maintainability and breadth gaps; ordinary write and review tails are covered per subspec 04.