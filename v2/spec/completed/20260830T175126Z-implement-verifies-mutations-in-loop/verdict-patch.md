Verifying the critical resume-path claim before issuing the verdict.
## Verdict: required outcomes

### 1. Implement-row resume after in-loop budget exhaustion must re-enter the write loop

**What must be true:** When an implement write row settles `surviving_mutation_failed` from in-loop reprompt budget exhaustion (`loop_finished.resumable: true`, `nextAction: "resume"`), `jarvis run resume` on that row must actually re-enter the write loop and re-run in-loop mutation verification — not short-circuit to a non-resumable idempotent terminal result.

**Why:** Subspec 01 requires implement-row `jarvis run resume` admission for in-loop exhaustion. The row advertises resumability via `composeRunOperatorError`, but `prepareRun` → `committedResult` treats the failed attempt (`outcomeKind: "done"`) like a terminal `invocation_failure` and blocks re-entry. Only `landing_failed` is exempt today. This is the first common case where the implement write row itself must resume after mutation failure; publication-time survivors route to the review row.

**Proof required:** A regression (e.g. `daemon-resume.test.ts`) that resumes an implement write row after in-loop exhaustion and asserts write-loop re-entry and re-verification — not only operator-error projection.

---

### 2. Exhaustion resume must be agent-free; pause-mid-reprompt must still replay context

**What must be true:** Two distinct resume semantics:

- **Pause during an active reprompt:** Restore `survivingMutationReprompt` from the log tail and inject `write.surviving-mutation-reprompt` (subspec 02 — already tested for pause).
- **Resume after terminal in-loop budget exhaustion:** Do **not** restore reprompt context or inject the live-agent reprompt. Resume is agent-free: operator fixes coverage manually, then resume re-runs in-loop verification.

**Why:** `reconstructWriteResume` unconditionally restores the last `surviving_mutation_reprompt` from the log tail. An exhaustion tail still contains that event, so fixing outcome #1 alone would resume into a live-agent reprompt — contradicting subspec 01, `write-behavior.md` (agent-free implement-row exhaustion resume), and `operator-runbook.md` (fix coverage, then `jarvis run resume`).

---

### 3. Operator docs must not over-generalize `surviving_mutation_failed` resume

**What must be true:** Durable docs must consistently distinguish:

- In-loop miss → live-agent reprompt while budget remains.
- In-loop budget exhaustion on the implement write row → agent-free `jarvis run resume` on that row.
- Publication-time repair-introduced survivor → review `write.mutation-repair` on the review row, not implement write-loop re-entry.

**Why:** Subspec 04 acceptance criteria require aligned operator semantics. `write-behavior.md` line 558 blanket-claims all `surviving_mutation_failed` rows resume via `jarvis run resume` on that row; line 560 already has the correct split. `operator-runbook.md` § Publication/completion failures (~636) still reads generically while § Surviving mutation failures (~644) is correct. Docs must match the behavior fixed in outcomes 1–2.

---

### 4. Stale `write-loop-input.ts` header comment

**What must be true:** The file header comment must not still say agents are "stranded at publication" now that `KILLING_TEST_RULE` documents in-loop verification at implement `done`.

**Why:** Internal comment contradicts landed behavior; trivial alignment fix.

---

### Not required for merge (acceptable as-is or follow-up)

- **`intent.md` open checkboxes:** Housekeeping relative to checked subspecs; no behavioral gap.
- **`publishCompletion === false` / `no-work` test gaps:** Code path appears correct (verification runs on all `patch.prompt.body` `complete` iterations with no `publishCompletion` guard); optional hardening only.
- **`SPEC_PATH` asymmetry vs `write.mutation-repair`:** Defensible for mid-subspec in-loop reprompt; optional documentation note only.
- **Publication confirm-only E2E without `readyFinalizer` mock:** Within subspec 03's seam-based scope; existing publication wiring unchanged.