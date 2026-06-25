## Verdict

The draft is structurally sound — correct subspec shape, decisions that name ruled-out alternatives, docs updates present — but three load-bearing conceptual gaps must be closed before implementation, plus several cheap precision fixes. All findings below are upheld.

### Must-fix

1. **Pin the actual divergence mechanism.** The spec describes the symptom (push rejected non-fast-forward, HEAD diverges) but never states *why* `origin/<branch>` holds commits the worktree HEAD lacks. If this same worktree pushed the implementation commit, local equals remote and rebase is a no-op — so something *else* must advance the remote tip. The spec must record the observed #499 cause as a decision. This is load-bearing: choosing rebase, and asserting it's safe to inherit `origin/<branch>` onto the PR head, both depend on knowing the remote moved with commits this PR *should* carry (vs. foreign work the rebase would wrongly pull in). Rebase is a correct convergence primitive regardless, but the spec cannot claim safety without naming the cause.

2. **Resolve the conflict path's residual divergence.** As written, a rebase conflict aborts (`git rebase --abort`) and exits `11` — leaving the actuator commit on the old base, unpushed, with the worktree HEAD still diverged from the PR head. That is the exact failure the intent set out to eliminate, silently recreated on the conflict branch. Worse, exit `11` then triggers the existing moved-tree auto-ready behavior, which can flip the PR ready while the actuator commit was never pushed. The spec needs an explicit decision on the actuator commit's fate on conflict (keep vs. discard) and must acknowledge that divergence persists in this branch rather than implying the worktree is left clean. The current AC ("implementation commits intact; not left mid-rebase") is silent on both points.

3. **Stop leaning on the prior recovery as a reconciling backstop.** The fetch-failure decision claims falling through to push is safe because the after-the-fact recovery (#511) is the backstop. That recovery only re-runs the ready gate and flips a checkbox / `gh pr ready`; it does **not** reconcile divergence. On the fetch-failure path, divergence can therefore still occur. The spec must state this honestly and not present the prior recovery as if it reconciles. (Citing `#511` is also fragile — it references an intent commit, not confirmed shipped behavior.)

### Should-fix

4. **Distinguish fetch-failure from missing rebase target.** The skip decision collapses "fetch failed (offline/no origin)" and "fetch succeeded but `origin/<branch>` ref absent (no upstream)" into one case. These are different conditions and the rebase target can be missing even after a successful fetch. Name both, and reuse the existing upstream check rather than re-deriving it.

5. **State the precise trigger condition.** "When the remote is ahead" is directionally ambiguous. The testable condition is "`origin/<branch>` contains commits not reachable from local HEAD" (the divergent both-ahead case). Stating it precisely both prevents a wrong-direction check and sharpens the helper's test.

6. **Anchor the no-change preservation AC.** AC #2 ("the no-change path is unchanged") is a preservation AC with no test/source anchor — exactly what the spec-guidance "cite the test, don't paraphrase" rule and the `missing-anchor-behavioral-ac` validator flag. Cite the existing no-change-path test instead of paraphrasing.

7. **Separate helper scope from caller scope in the tests.** The helper fetches + rebases; the push lives in the caller via `pushCurrent`. A unit test of the helper cannot assert a fast-forward *push* succeeded — only that the rebase left the branch fast-forwardable. AC #5 and the checklist conflate the two; split helper-scope (rebase) from integration-scope (push succeeds), or move the push into the helper's contract explicitly.

8. **Fix loose reuse/wording.** Reuse the existing best-effort-fetch helper rather than re-inventing its "fetch failure non-fatal" semantics. And replace the "exit-11 actuator-failure path" wording — there is no literal exit-11 path; the actuator failure throws `ReviewTerminalError` that is remapped to `11`. Say that, so an implementer isn't sent hunting for an `11` that isn't in the throw site.

### Rationale

Findings 1–3 go to the intent's core promise — "push rejection should be impossible in the common case… the branch stays convergent." A fix that cannot explain the divergence cause (1), recreates divergence on conflict (2), and overstates its backstop (3) does not yet deliver that promise. Findings 4–8 are correctness and spec-quality tightening required by the repo's acceptance-criteria and decision-ledger conventions. None were over-reaches; all should be addressed in refinement, with 1–3 blocking.