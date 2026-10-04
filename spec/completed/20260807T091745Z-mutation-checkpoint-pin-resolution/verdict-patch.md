Verifying mutation pin placement and key implementation details before issuing the verdict.
## Verdict: required outcomes before merge

### 1. Restore mutation-checkpoint guard wiring on the correct pins

Each mutation AC must invert the guard that implements the behavior named on that pin, and previously shipped mutation contracts must remain satisfied.

- The adjacent-line-forward guard (`PIN_TITLE_PATTERN` on `lines[lineIndex + 1]`) must live on `directive immediately above test declaration links to that pin title`, per the completed forward-line subspec (`20260807T042949Z-mutate-directive-above-test-attribution`).
- The continuation-title guard must live only on `multiline test.each continuation title links directive`, inverting opener-anchored continuation resolution — not adjacent-line forward.
- The multiline pin must not carry both guards; stacking lets forward-line inversion satisfy a continuation-title mutation AC without proving that guard.

**Rationale:** Mutation checkpoints are the contract that guards are real and pinned to the right behavioral surface. Misplaced directives break a ticked cross-spec AC and weaken both subspecs’ mutation proofs.

---

### 2. Align continuation opener matching with the contracted `test.each` surface

The subspec decision ledger, behavioral ACs, and doc updates prove and document multiline **`test.each`** only. Implementation currently treats `describe.each` openers the same way.

Either narrow opener detection to match that contracted surface, or expand proof and durable docs to cover `describe.each`. Do not ship undocumented behavior beyond what acceptance criteria and the ledger claim.

**Rationale:** Decisions must not outrun verifiable contracts; extra matcher breadth is scope creep without proof.

---

### 3. Correct operator-runbook extension-mismatch hand-fix guidance

The runbook groups “both `.ts` and `.tsx` copies present” with `unresolved_pinning_test` hand-fix paths. Implementation resolves immediately when the criterion’s primary basename matches any on-disk file — even if alternates also exist — which can link the wrong file and yield hollow or mis-caught, not `unresolved_pinning_test`.

Hand-fix guidance must distinguish:

- **Primary basename matches a file** → resolves to that path (wrong-file risk; fix criterion path or basename, not “unresolved”).
- **Primary matches zero files and alternates yield zero or multiple matches** → `unresolved_pinning_test` (existing ambiguous-basename behavior).

**Rationale:** Documentation AC requires accurate failure-mode triage; current wording misdirects operators on a real collision case the decision ledger already defines.

---

### 4. Update `enclosingPinTitle` doc comment when touching the verifier

The function comment still describes only nearest enclosing `test`/`it` blocks and omits opener-anchored `test.each` continuation attribution now implemented.

**Rationale:** Keeps inline docs consistent with behavior operators and authors rely on from durable docs.

---

### Not required for this pass

- Negative ACs for extension-tolerance fail-closed edges, path-qualified refusal, or `.mts`/`.cts` exclusion — ledger and durable docs cover these; verdict-plan marked negative fixtures optional.
- `intent.md` sync — subspec is authoritative for implement runs and ACs are ticked; drift is housekeeping, not a behavioral gap.
- Bounded continuation scan (`j` through directive line), narrow `])("title"` pattern, and string-literal mutation anchors — consistent with spec shape and established harness pattern.

---

### Core behavior: approved as implemented

Opener-anchored forward scan during backward walk, extension-tolerant bare-basename lookup (primary zero → union alternates → exactly one), behavioral fixtures, and durable doc updates (`spec-guidance`, `v1-behaviors`, runbook reconciliation with `#2682`) satisfy the subspec’s functional contract. Remaining work is guard-pin integrity, contracted-surface alignment, and one runbook precision fix.