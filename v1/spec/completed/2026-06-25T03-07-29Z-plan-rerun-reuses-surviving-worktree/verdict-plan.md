## Verdict

The draft's design choices (no flag, teardown-not-reuse, reusing existing teardown, the doc updates, the citation-form ACs) are sound and need no change. The defect is omission: the disposability predicate is load-bearing classification logic with a live consumer, yet four+ edge cases that determine whether it classifies correctly are unspecified. Per this repo's "prefer deferral over invented precision" rule, deferral applies to first-consumer unknowns — not to classification logic the run already exercises. These must be pinned now.

### Must-fix (each can misclassify and destroy or strand real operator state)

1. **Pin the base ref for "no commits beyond base."** Today the base branch is resolved only for the *original* run and after name-finalization, so a re-run has no defined base to diff `plan/<name>` against. Specify how the base is resolved on re-run (e.g., merge-base of the surviving branch against current HEAD) and add an AC. Without this the "no plan commits" sub-check is undefined and flips both ways — tearing down real work or stranding scratch.

2. **Strip the timestamp prefix in the committed-spec-dir check.** Committed plan specs land at `<targetDir>/<timestamp>-<name>`, but the existing same-name path check looks for the unprefixed `<targetDir>/<name>` and never matches — so the "no committed spec dir" disposability sub-check is dead-on-arrival for this repo's timestamped config. Specify prefix-stripping (mirroring the external-spec-dir collision check) and note it corrects a pre-existing miss. Add/strengthen the AC so the committed-spec-dir case provably blocks teardown.

3. **Fail closed on an unknowable remote.** The `origin/plan/<name>` check returns "absent" on offline/transient errors, which would classify a pushed branch as disposable and trigger local teardown — contradicting the preserve-pushed-work guarantee. Specify that an unknown/unreachable remote result is treated as non-disposable, with an AC.

4. **State the dirty-worktree contract explicitly.** The intent's headline trigger (SIGINT before the draft commit) is precisely an uncommitted-scratch worktree, which the predicate silently treats as disposable and force-removes. Make this an explicit decision ("an uncommitted plan worktree is disposable scratch") with an AC, so the destruction is a documented contract rather than an accident.

### Cheap precision fixes

5. **Partial-teardown fallback.** Teardown swallows failures, so a failed `worktree remove` can surface later as a confusing creation error. State that the existing actionable worktree-exists message is retained as the partial-teardown fallback (the draft's conditional "drop if it becomes dead" already permits this — make the intent explicit), ideally with an AC.

6. **Tighten the preservation claim.** A branch carrying a plan commit but no committed spec dir is preserved on disk but not `--resume`-able. Change "preserved for `--resume`" to "preserved" in the non-disposable AC; don't promise resume where the resume path requires an `index.md`.

7. **Pin evaluate-once ordering.** The predicate is consumed at three sites (collision-exemption, teardown, recreate). State that disposability is evaluated once and the result threaded — not re-evaluated — to avoid TOCTOU divergence.

8. **Define branchless/worktreeless evaluation.** The "worktree and/or branch present" phrasing leaves "no commits beyond base" undefined when the branch or worktree is absent. Add one line: an absent branch trivially has no commits-beyond-base; an absent worktree is evaluated on the branch alone.

### Rationale

Findings 1–4 are correctness gaps where an implementer guessing wrong silently destroys resumable/pushed operator work or strands scratch — the exact friction the intent exists to remove, inverted. 5–8 are low-cost decision-record tightenings that prevent divergent implementations and overclaimed guarantees. All belong in `## Decisions`/`## Acceptance criteria` with the corresponding behavior reflected in the documentation updates already listed.