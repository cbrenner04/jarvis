Reviewing the spec draft and advocate analysis to produce a self-contained adjudication verdict.
# Adjudication verdict — mutation-checkpoint-keystone

## Required refinements

### 1. Resolve the meta-keystone vs inert-path acceptance contradiction

Acceptance criterion 58 (`headline revert stays green after keystone apply` on this subspec's keystone pin) conflicts with decision 15 (this subspec's keystone reverts the inert-headline refusal). Reverting that refusal removes the behavior `refuses completion when keystone mutation survives` asserts; the pin should go red (caught), not green (inert). A ticked AC requiring green survival on that pin would block the implementing run at completion.

The spec must separate two contracts:

- **Meta-keystone obligation** — this subspec's keystone proves the headline change matters (revert turns the pin red; caught).
- **Inert-path proof** — a fixture where headline revert truly stays green yields `inertHeadline` refusal with distinct messaging.

Prove the inert path inside `mutation-checkpoint-keystone.test.ts` via an embedded fixture subspec (same pattern as `write.test.ts`), not as a completion-blocking AC on the implementing subspec's own keystone pin. Either drop AC 58 or rewrite it to assert the meta-keystone is caught, not surviving.

### 2. Task verifier entry so keystone-only subspecs are not skipped

`verifyMutationCheckpoints` currently returns an empty report when guard criteria count is zero. Keystone-only fixtures and `allows completion when keystone mutation turns its pin red` cannot work without changing that gate. The spec must require that keystone selection runs when guard count is zero, and early-return only when both guard and keystone selectors are empty.

### 3. Align intent and documentation with the guard-gated missing-keystone slice

The subspec defers refusing runtime-behavior subspecs that have headline production changes but no guard checkpoints and no keystone. Intent decision 3 and documentation bullets still promise broader refusal for any executable headline change without a `Keystone checkpoint:` criterion. Intent acceptance criteria, decisions, and doc-update bullets must match the guard-gated implement boundary actually tasked, with explicit deferral for headline-only detection and plan-draft validator work.

### 4. Add acceptance coverage for >1 ticked keystone refusal

Tasks require refusing when ticked `Keystone checkpoint:` count exceeds one, with blocker text distinct from hollow and inert-survival messaging. Acceptance criteria cover guard-without-keystone but not the >1-keystone case. Add a failing-test AC (or extend an existing scenario) that proves >1 ticked keystone criteria are refused at completion.

### 5. Specify where keystone linker failures land in the report

Tasks route surviving keystone mutations to `inertHeadline` but do not say where mislinked or missing-directive keystone criteria go. Today those land in `hollow` with guard-oriented detail. The spec must require keystone authoring failures surface with keystone-flavored diagnostics (e.g. `unparseable` or a keystone-specific bucket), not hollow-guard messaging, so operators can distinguish authoring mistakes from inert headline and from hollow guards.

### 6. Make green-under-mutation routing for keystones an explicit verifier outcome

"Invert the refusal surface" is stated in decisions but the task list does not pin where classification inverts (parameterized `applyAndClassify`, call-site branch, or post-classification reroute). The spec must require that keystone green-under-mutation results never populate `hollow` — they populate `inertHeadline` — as a single, unambiguous verifier outcome.

### 7. Extend harness acceptance criteria to cover `shared/**` test surface

Tasks change `shared/mutation-checkpoint-criteria.ts`. Repo CI scope unions `shared/**` into `test:v1`, `test:v2`, and `test:integration:v2`. Requiring only `test:v2` under-tests shared selection changes. Harness ACs must include at least `bun run test:shared` or full `bun run test`.

### 8. Clarify keystone selection requires the `Keystone checkpoint:` prefix

Decision says keystones are selected only via the dedicated prefix; the shared-selection task says "mirroring guard selection" including directive-shaped `@mutate` in block. Guard selection admits `@mutate`-only blocks without the guard marker. The spec must state that `Keystone checkpoint:` is necessary for selection — `@mutate` in the block is for linking only, not alternate selection.

### 9. Task write-loop reprompt gating for `inertHeadline`

Tasks extend `isMutationCheckpointCriteriaTickedMiss` but not `repromptableMutationDirectiveBlocking`, which today bails only on `hollow`. Inert-headline refusal is not a fixable directive typo; it must hard-block completion like hollow (no reprompt path). The completion-boundary tasks must cover write-loop settlement for `inertHeadline.length > 0`.

### 10. Resolve operator-runbook manual-revert bullet outcome

The docs task says "reference replacing the manual revert bullet when keystone ships" without stating delete vs demote vs keep. Gate trust currently documents manual headline-revert verification. The spec must require a single operator path: delete or demote the manual-revert bullet once keystone automation is documented, avoiding duplicate guidance.

---

## Rationale summary

Refinements 1–3 are blocking: AC 58 as written makes the implementing subspec self-blocking; the verifier early-return prevents keystone-only verification from running; intent/subspec divergence misstates shipped scope. Refinements 4–10 close coverage and operator-facing gaps — untested refusal modes, misrouted diagnostics, incomplete CI scope, ambiguous selection rules, incomplete completion integration, and ambiguous docs — without changing the core architecture (separate selection, inverted refusal surface, reuse of apply/run/restore).

## Not required for merge

Single-subspec vertical slice across `shared/`, verifier, completion, and docs is coherent and independently testable. Reusing `caught` for both guard and keystone diagnostics is acceptable. Adding a `mutation-checkpoint-regression.test.ts` row, plan-time hollow-pin scanning for keystones, and dedicated shared selection unit tests are reasonable follow-ons but not required if completion-boundary tests exercise real selectors end-to-end.