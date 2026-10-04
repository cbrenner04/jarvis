Reviewing the implementation and spec to issue a self-contained verdict.
## Verdict

### 1. Close the out-of-union preservation hole for decisions and documentation bullets

**Required outcome:** When `normalizePlanDraftSpecDir` partitions `## Decisions` or `## Documentation updates`, a bullet with exactly one classified surface that is **not** in the split’s AC-derived boundary list must not be silently dropped from every emitted child. The split step must fail deterministically (same class of failure as multi-surface bullets), naming the heading and bullet text.

**Rationale:** This patch’s purpose is verbatim partition without drop or duplicate. Unclassified bullets already floor to the first child; multi-surface bullets already hard-error. Classified single-surface bullets whose surface is outside the split set currently vanish — a silent loss regression for decisions and documentation that did not exist under the pre-change duplicated-body path. The completed subspec forbids dropping unclassified preserved prose and requires fixtures to catch dropped bullets; leaving classified orphans silently omitted contradicts that preservation contract even though current k2/k3 fixtures do not exercise the case.

**Test requirement:** Add a regression test that proves the split hard-errors (and does not emit children) when a parent draft contains a decision or documentation bullet classifying to a surface absent from the parent’s AC union — parallel to the existing multi-surface acceptance-criteria throw test.

---

No other findings require actuator action for this patch:

- Split-residue stripping scope, bullet-only section contract, invert-guard k2 coverage, deferred operator docs, pre-change CI negative control, test-hook pattern, and cosmetic formatting are either explicitly scoped out, already satisfied by checked acceptance criteria, or acceptable follow-up hardening without blocking merge.