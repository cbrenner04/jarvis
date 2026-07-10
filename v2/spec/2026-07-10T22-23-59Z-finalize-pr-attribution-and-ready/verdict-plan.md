# Verdict — Required Refinements

## Upheld (blocking)

**R1 — Reconcile attribution source with v2's single-meta-commit reality.**
v2 does not create per-subspec commits: a completed run collapses all work into one `jarvis: complete run` meta-commit carrying `Spec: <specPath>` and only the *final* binding's `Jarvis-Agent` trailer. A verbatim port of v1's `Spec: `-prefix commit selection therefore matches exactly one commit and attributes the whole footer to the completion agent — a direct contradiction of the intent's headline decision ("rules out binding attribution to the completion agent") and slice 00's first decision. As written, the ACs are satisfiable by code that produces the wrong footer.

The spec must pin how per-agent attribution is actually recovered under the collapse model, and make it consistent end to end. Options the refinement must choose between (and state the ruled-out alternative):
- exclude the meta-commit from selection and name the real per-agent source (e.g. collapsed per-attempt trailers), then rewrite the commit-selection and dedup ACs to match that source; **or**
- accept the collapse model, in which case the intent's "rules out final agent" decision is wrong and both the intent decision and slice 00 must be rewritten to describe single-agent (or final-agent) attribution honestly.

Either way, the imported multi-commit dedup / first-seen machinery must be reconciled with the actual commit shape, not left describing a world v2 doesn't have.

**R2 — Pin the ready-flip success-detection contract relative to the reused retry policy.**
The reused transient-retry helper treats every non-fast-forward error as transient and retries to exhaustion. A raw `not a draft` / `already ready` error would therefore burn all attempts and fail finalization — the opposite of the intended "treat as success." The two slice-01 decisions (reuse the bounded retry *and* treat those responses as success) conflict, and no AC says where the success guard sits. The spec must pin: the success guard short-circuits **before** the transient classifier; and the detection contract (which stream, exact vs substring match, and the exit-0/no-output case where an already-ready PR emits nothing to intercept) so an implementer isn't inventing it.

## Upheld (coherence — refine)

**R3 — Define the joint post-publish state machine across 00 and 01.**
Today only one failure surface is documented (retryable `completion_commit_failed`, run stays `completed`). The spec adds two more failure points (body-refresh, gate/flip) but never says whether they reuse that code or introduce new error codes / next-actions, whether refresh and gate+flip are one boundary or two, or the resume replay order. The two slices must jointly pin: the ordering (refresh → gate → flip), the durable status/error surface for each failure point, and what re-runs on resume and in what order — so the doc-update ACs have concrete semantics to document rather than an implementer building two independent boundaries with a resume-ordering hazard.

## Upheld (minor — one-line acknowledgements)

**R4 — Missing-vs-red gate script.** State explicitly that a missing `ready` script and a failing one are deliberately not distinguished (coarse non-zero = not-ready), consistent with the existing missing-`gh` precedent; pin distinction to first consumer.

**R5 — Gate timeout.** Add one line: gate runs unbounded, timeout/cancellation deferred to first consumer.

**R6 — Generated-narrative hash path.** Add one line stating the hash-verified generated-narrative mechanism is deliberately not ported (plain-marker preservation only), so it doesn't read as an accidental omission.

**R7 — Empty-footer body shape (contingent on R1).** If R1 resolves by excluding the meta-commit, zero-qualifying-commit branches yield an empty footer; pin the body shape in that case (empty footer ⇒ no `---` separator; body is regenerated header, plus narrative if present).

**R8 — Index ordering note.** Add a one-line note in `index.md` that 01 depends on 00 (flip-after-refresh), since 01 is not independently testable end-to-end before 00.

## Not upheld

- Structural naming (hooks/symbols/error codes) is permitted — these are harness subspecs where structure is the contract.
- Gate resume semantics are already answered by slice 01's "resume re-runs the gate" AC; the only residue folds into R3.

## Rationale

R1 and R2 are the priority: in both, the current ACs can be satisfied by code that does the wrong thing (wrong attribution; failed finalization on a benign response), which violates the guidance that acceptance criteria state verifiable correct behavior. R3 is required because the doc-update ACs demand documenting failure semantics the spec never defines. R4–R7 keep the spec honest under the repo's "prefer deferral over invented precision" rule — each is a legitimate deferral that should be recorded as a deliberate choice rather than an omission.