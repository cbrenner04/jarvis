Reviewing implementation against the spec and advocate findings before issuing the verdict.
# Adjudicator verdict

Required outcomes before merge:

## 1. Rogue-path parity at the pre-completion gate

**Outcome:** Intent-split pre-completion validation must reject the same out-of-stage writes as deferred `landIntentWorkflowOutput` — immediate, non-repromptable write-loop `landing_failed` without spending reprompt budget.

**Why:** Subspec 02 requires write-loop and deferred landing to agree on rogue-path behavior via the same changed-path source. The gate currently filters to stage paths only, so rogues outside `.jarvis-intent-stage/` can pass the write loop and fail only at deferred landing. A regression must pin immediate terminal failure on rogue paths.

## 2. Stage bytes must survive documented write-row recovery

**Outcome:** After write-loop `landing_failed` with `resumable: true`, operator hand-edits under `.jarvis-intent-stage/` must still be present when the resumed write loop runs — not only at resume admission. End-to-end coverage must assert stage contents after at least one resumed iteration, not spawn-only admission.

**Why:** Subspec 02 and `operator-runbook.md` promise hand-edit + `jarvis run resume` re-enters the write loop with stage intact. `executeIntentSplitWrite` wipes the stage at every iteration start, so documented recovery is false. Either preserve populated stage on resume (and on landing-contract reprompt), or revise durable docs to remove the claim.

## 3. Landing-contract reprompt must not destroy non-offending staged intents

**Outcome:** When validation fails on one staged file in a multi-intent split, valid sibling files must remain in `.jarvis-intent-stage/` for the reprompt iteration (or the reprompt must carry enough context to recreate them without the original seed).

**Why:** Stage wipe on every iteration plus a single-file reprompt makes N>1 splits lose valid siblings on each miss. In-loop reprompt is unreliable for the common multi-intent case unless stage is preserved across reprompt iterations.

## 4. Pause/resume after a repromptable landing miss must not silently drop violation context

**Outcome:** If the write loop pauses after scheduling a landing-contract reprompt, resume must restore violation and offending-file context for the next iteration — or durable docs must state that pause after a repromptable miss loses that context and operators must fix in-loop or re-dispatch.

**Why:** `pendingLandingReprompt` is loop-local and not restored by `reconstructWriteResume`. Resume after pause yields a fresh split prompt and another stage wipe, undermining the reprompt path.

## 5. Durable docs must match actual violation and recovery semantics

**Outcome:** Align `write-behavior.md` and `operator-runbook.md` with implementation:

- Distinguish silent content repair (name/H1/Prerequisites normalization) from failures that trigger `write.landing-contract-reprompt`.
- Clarify that empty stage before `done` fails `artifact.exists` / `contract_miss`, not the landing gate — or adjust taxonomy wording accordingly.
- State `nextAction: "resume"` alongside `resumable: true` for write-loop `landing_failed`.
- Give write-row recovery the same actionable `jarvis run resume <runId>` guidance as review-row, including how to identify the write step `runId`.

**Why:** Subspec 02 documentation updates are checked, but current text overstates reprompt targets and understates operator steps. Docs must not claim behavior the harness does not provide (items 2–4).

## 6. Spec traceability hygiene

**Outcome:** Subspec 02 acceptance criteria should reference `write-loop-intent-landing.test.ts` (where pinning tests live), or add a pointer from `write-loop.test.ts`. Close or reconcile open `intent.md` acceptance criteria with completed subspecs.

**Why:** Auditability only; no runtime change, but intent-level ACs remain open while `index.md` marks the spec complete.

---

**Not blocking merge** (optional cleanup): brittle `intentLandingOffendingFile` parsing for future repromptable errors; dead `"failed to read stage directory"` branch in repromptability classification; `maxIterations === 1` first-miss exhaustion; doubly-prefixed filename edge case.

**Solid — no further action:** prerequisites-prose reprompt wiring, budget exhaustion → write-loop `landing_failed` with preserved stage at terminal settlement, `NN-` normalization order, prompt filename contract, review-last no double-reprompt, `promptId`/`promptPlaceholders` on snapshot and resume reconstruction, mutation checkpoint comments in tests.