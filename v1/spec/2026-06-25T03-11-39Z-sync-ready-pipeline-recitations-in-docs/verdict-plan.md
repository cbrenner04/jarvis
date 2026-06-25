README confirmed: lines 464-466 enumerate `check:fix → typecheck → test → check` as a comma list ending at `check` — a genuine step-level recitation the draft misses. Verdict follows.

---

## Verdict — refinements required

**1. Add `README.md` to scope (or explicitly exclude it with rationale).**
`README.md:464-466` enumerates the ready pipeline at step level (`bun run check:fix` … `typecheck`, `test`, and `check`) and stops at `check` — exactly the stale pattern this spec exists to fix. The intent's list is labeled "**Known** stale recitations" (non-exhaustive) and its Behavior section states a general property over "narrative docs that enumerate the ready pipeline at step level." README is the repo's highest-traffic such doc; leaving it stale defeats the spec's own goal. The spec must either correct it or record a deliberate exclusion with a reason — a silent drop is the wrong end state.

Note for the edit itself: README is **not** a mechanical arrow-append. It uses comma-list prose (not `→` arrows) and says `check:fix` (safe fixer), not the canonical `check:fix:unsafe`. The fix is to add `bun run lint:md` to that comma sequence. Per the spec's own "don't rewrite earlier steps" decision, leave the `check:fix` wording as-is. The checklist bullet for README should reflect this tailored edit, not the generic append instruction.

**2. Re-phrase acceptance criteria as an observable property over the named doc set.**
AC #1 currently enumerates three files, so the spec can go green while a recitation drifts elsewhere — which is precisely how README slipped. Once README is in scope, phrase the AC as a checkable property over the explicit, named doc set (e.g., "no step-level ready recitation in [named docs] ends at `check`"). Keep it closed/verifiable — a fully open-world "anywhere in the repo" claim is not checkable and conflicts with spec guidance — but close the gap that let an in-scope doc be omitted.

**3. Add a one-line acknowledgment of the `check:fix` / `check:fix:unsafe` mismatch.**
The draft names `run-loop.md:125` as "the single canonical list," but that line reads `check:fix` while `v1-behaviors.md`, `run-loop.md:217`, and the intent's own Behavior text read `check:fix:unsafe`. Reconciling the fixer wording is correctly out of scope (this spec syncs only the `→ lint:md` tail). But a reviewer reading "canonical" against an inconsistent source will read it as oversight. Add a one-line Decisions note stating the mismatch exists and is out of scope, so the choice is visible rather than silent.

**4. Flag the mermaid paren-placement caution in the affected `workflows.md` checklist bullets.**
The mermaid nodes render as `["… check)<br/>…"]`; a naive `→ lint:md` append placed after the `)` malforms the node. The checklist bullets for the mermaid edits should note that `lint:md` goes inside the step sequence, before the closing paren. Half a sentence; the one spot a mechanical append produces broken output.

**Not requiring change:** the Documentation updates claim is accurate — `v1-behaviors.md` already carries the full `… → check → lint:md` sequence and needs no edit. The `run-loop.md` table being left unchanged is correct (it is the source of truth).