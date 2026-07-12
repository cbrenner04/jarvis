## Verdict — refinements required

**1. `01` — name the durable source of the summary, not a call-return handoff.**
The current decision ("reuse `landIntentWorkflowOutput(...).files` from the landing call") reads as a same-invocation handoff and does not survive republish or the review-last path. State instead that the summary is **re-derived from the landed durable spec dir on every publish** (landing is idempotent and returns the owned files for an already-landed invocation). This is what actually makes the retry/resume AC satisfiable and keeps the no-persist decision in `00` correct.

**2. `01` — the reviewed-intent (review-last) path currently has no mechanism.**
Today the review-last branch discards the landing result and leaves the publication spec path unset at the publish site, so AC 4 ("reviewed-intent workflows produce the same summary") is asserted with nothing behind it. The spec must make the derivation cover both the plain-intent and review-last branches (the durable-dir re-derivation in (1) does this naturally). Do not ship an AC whose mechanism doesn't exist.

**3. `02` — replace the path-shape trigger with a positive discriminator.**
"Spec path is a directory containing `index.md` and the run is not an intent run" is a negative, inferential predicate that an implementer can easily read backwards onto implement/patch runs — which `00` forbids from changing the body. Identify the spec-authoring (plan/write) publish site itself as the trigger.

**4. `02` — say who parses `index.md`.**
`00` decides the publisher interprets nothing and takes a pre-rendered string. `02` must therefore state that parsing/rendering happens at the runner's publish call site and the publisher receives a finished string. One decision line; without it `00` and `02` are in tension.

**5. `00` — pin the non-workflow publish sites.**
Direct `jarvis2 write` and the daemon publish through their own sites and will supply no summary. Record that as an explicit decision (today's body stands there) so the "absent ⇒ byte-for-byte unchanged" guarantee has a named consumer rather than reading as a hypothetical.

**6. `00` — ACs 4 and 5 are preservation ACs; cite the pinning tests.**
"Refreshing twice yields an identical body" and "a different summary replaces the prior block" are properties the existing header-rebuild + narrative-preservation behavior already provides. Written as prose, they invite an implementer to invent summary delimiters nothing needs. Per the refactor-AC rule, cite `pr-body-refresh.test.ts`'s body-shape tests instead of paraphrasing.

**7. Both `01` and `02` — close the empty/degenerate cases.**
- `02`: index with an H1 but zero checklist items ⇒ H1 only, no empty list (mirror `01`'s empty-files rule).
- `02`: state explicitly that the checklist is **not** truncated or capped (v1's header doesn't cap); "terse" in the intent means no generated prose, not a length limit.
- `01`: when the creation title is the generic fallback (`jarvis: complete run`), suppress the subject line rather than render the fallback as a subject.

**Not upheld:** collapsing `00` into `01` (it is a real transport change across three files with an independently testable byte-for-byte guarantee, and it is the correct place to pin that guarantee before any producer exists); the bare-creation-body concern (a permanently unrefreshed body is a failed publish surfaced to the operator, out of scope).