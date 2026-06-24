## Verdict

The spec's direction is sound — a one-time, isolated, mechanical normalize gated by the existing `lint:md`. But it rests on a false premise (every violation is autofixable) and silently drops an intent constraint. The following refinements are required.

### Required refinements

**1. Resolve the AC#1 ↔ AC#4 contradiction for non-autofixable violations.**
A non-trivial set of violations cannot be cleared by `--fix` (missing/incorrect top-level H1, duplicate headings, broken link fragments). Clearing them by hand requires structural/content edits, which AC#4's blanket "no prose, ordering, or content changes" forbids. As written, an implementer cannot satisfy both AC#1 ("lint exits 0") and AC#4 simultaneously. The spec must state explicitly how non-autofixable violations are handled and remove the contradiction. It must not stay silent. (The "do not edit the config" decision currently forecloses the config-based resolution path; if that path is chosen, that decision must be relaxed to forbid only *scope* changes — globs/ignores that widen or narrow the corpus — while permitting rule-disable edits.)

**2. Restore the intent's generated-files exemption.**
The intent explicitly exempts generated files; the spec dropped this carve-out. Plan-mode review artifacts (`verdict-*.md`) are regenerated on each resume, so normalizing them is non-durable churn that re-breaks the gate on the next plan run — and they are the largest cluster of the non-autofixable structural violations from (1). The spec must decide their treatment and honor the intent's exemption rather than normalize regenerated files. Treating machine-generated artifacts the way `node_modules` and `completed/` are already treated is consistent, not scope-narrowing of the durable corpus.

**3. Correct the mechanical-category list in AC#4 (and the problem statement).**
AC#4 and the problem statement name "line-wrapping" and "trailing whitespace" as expected edits, but the house config disables the line-length and trailing-whitespace rules — those edits will never appear. The enumerated categories must match the rules that actually fire, so AC#4 grades against producible changes rather than an impossible list.

**4. Make AC#4 falsifiable.**
Once (1) and (3) are fixed, AC#4 needs a stated verification procedure — how a reviewer confirms the diff is mechanical-only (e.g., edits limited to the enumerated rule categories, with any permitted non-autofix edits bounded to the specific rules named in (1)). As written it has no check and is partly false.

### Minor (address while refining)

**5. Soften the "large mechanical diff" framing.** The actual violation count is modest; the justification for isolating this change is reviewer clarity (formatting separated from logic), not diff size. Adjust the problem statement so it does not set wrong expectations.

**6. Add an environment note.** The lint tool is not present until dependencies are installed; the first `bun run lint:md` may fail module-not-found. A one-line task note that this is environmental, not a lint failure, prevents misdiagnosis.

### Rationale

Findings (1) and (2) are load-bearing: the spec is currently unimplementable as written (contradictory ACs) and violates its own source intent (dropped generated-files exemption), which would also produce recurring churn. (3) and (4) are accuracy/falsifiability defects — an AC that grades against impossible changes is both wrong and unverifiable, contrary to the spec-guidance requirement that acceptance criteria be checkable. (5) and (6) are low-cost clarity fixes.