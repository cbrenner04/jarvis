## Verdict

The intent capture and scoping are sound — no finding challenges the spec's goal or boundaries (run-side tolerance and the legitimate no-commit `repo:` binding stay correctly excluded). The required refinements are about ordering-anchor precision, the matcher grammar, and a few unhandled cases. Address the following:

### Required refinements

1. **Pin the strip's insertion point unambiguously.** `injectRepoLineIntoIndex` is invoked twice on the no-commit path (once pre-draft, which early-returns because `index.md` does not yet exist, and once post-draft, which is the real injection). The spec's singular "before `injectRepoLineIntoIndex`" is ambiguous and an implementer could target the inert pre-draft site, leaving the stray line intact. Restate the ordering in mode-independent terms that hold for both `commit: true` and `commit: false`: **the strip runs after `validateDraftOutput` succeeds and before the draft boundary check** — which is itself upstream of both the no-commit injection and the draft commit. This single phrasing replaces the current "before `injectRepoLineIntoIndex` … in both commit modes," which describes an anchor that does not exist for `commit: true` (both injection sites are guarded by `commit === false`).

2. **Handle a missing `index.md`.** `validateDraftOutput` can return valid with a blocker *before* confirming `index.md` exists, so "after validation passes" does not guarantee the file is present. The spec must state the strip no-ops when `index.md` is absent, and add an acceptance criterion covering it.

3. **Tie the retention matcher to `parseIndex`'s grammar.** Decision 2's literal `- [ ] [..](..)` is narrower than `parseIndex`, which tolerates leading whitespace and checked (`[x]`/`[X]`) items. A matcher narrower than `parseIndex` can strip a line the run side would have read, breaking the AC that requires `parseIndex` to see the same subspec list. Require the retention rule to be at least as permissive as `parseIndex`'s grammar (ideally by reusing it).

4. **Make "byte-identical" honest.** AC #3 requires a clean index be left unchanged while the task describes a "rewrite"; a naive filter-and-rejoin will not round-trip trailing-newline state. Resolve the contradiction — either skip the write entirely when the cleaned content equals what was read, or soften the AC to "semantically unchanged." Add a test feeding an index with no trailing newline.

5. **Decide explicitly on a diagnostic.** The surrounding draft flow already emits operator-visible warnings to stderr; stripping a stray `repo:` line silently hides a misbehaving prompt with no trail. Record an explicit decision (emit a one-line stderr notice on a non-empty strip, or deliberately stay silent) rather than leaving it an accidental omission.

6. **Record the placement decision (minor).** Add one decision line noting the strip is a standalone step rather than folded into `validateDraftOutput`, since validation must also run on the blocker path and is otherwise read-only — keeping the mutation out of the validator is the reason.

### Rationale

Findings 1–3 are correctness/clarity gaps: as written, the spec's anchors point at sites that are inert or nonexistent for one mode, and an unhandled missing-file case, any of which yields a wrong or crashing implementation. Finding 3 (matcher) and 4 (byte-identical) protect the spec's own acceptance criteria from being internally unsatisfiable. These align with the spec-guidance principle that ordering and contract anchors be precise and that decisions name the wrong alternative they rule out. Findings 5–6 are explicit-decision hygiene, not defects in the approach — record them so they are choices, not omissions. The decision record's existing quality (each entry naming its rejected alternative) should be preserved through these edits.

Findings on second-H1 / pre-title content are non-blocking; an optional extra test guarding "preserve the title H1" against "preserve all H1s" is a nice-to-have only.