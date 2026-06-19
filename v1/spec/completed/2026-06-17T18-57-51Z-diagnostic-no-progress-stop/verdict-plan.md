I'll ground my verdict in the actual code paths before issuing it. Let me verify the key claims about reachability, the exit-6 ordering, the parser's task-vs-subspec distinction, and the doc targets.The exit-6 ordering, the exit-1 empty-criteria gate (798), and the after-snapshot (955) are confirmed. Now let me verify the parser's task-vs-linkedSubspec distinction and `getActiveLinkedSubspecPath`, plus the existing no-progress tests and doc targets.The parser distinction is confirmed: a bare `- [ ]` line becomes a `task` but only a `linkedSubspec` when its body matches `[text](path)`. Now let me confirm the two no-progress tests use bare tasks (state B) and check the `getActiveLinkedSubspecPath` resolution plus the run-loop doc section.Both no-progress tests confirmed as state (B) — bare `- [ ] todo`, which produces no linked subspec, so `activeSubspecPath` is `undefined`. Let me confirm `getActiveLinkedSubspecPath` and check the run-loop doc exit-4 section plus the `v1-behaviors.md` content.I now have full grounding on every claim. All code paths are confirmed:

- `getActiveLinkedSubspecPath` returns `undefined` for bare-task indexes (state B); resolves a path only for `[text](path)` linked subspecs (state A). Both existing no-progress tests are state (B).
- Exit-6 dirty-worktree branch (1126-1136) preempts exit-4 (1190) only when the worktree is dirty → state-(A) exit-4 requires a clean tree, `git: false`, or prior-iteration-committed work.
- Empty-criteria is foreclosed upstream (exit 1 at 798); all-checked → `subspecCompleted`, never reaching 1190. Decision #2's "rules out crashing/empty list" is already true by construction.
- After-iteration snapshot source is `snapshotAcceptanceCriteria(afterSubspecPath)` (955).
- `run-loop.md` line 484 maps only the exit *code*; no bullet describes the message *contents* (net-new doc, not an edit). `v1-behaviors.md` line 281 likewise maps only the code.
- `printBoundedTail` (1191) precedes the stop line (1192); exit-6 model places criteria after the stop sentence.

Verdict:

---

## Verdict — refinements required (first pass)

The spec is correctly scoped and its core decisions hold. The diagnostic targets the reachable state where the index links a subspec, a prior iteration or operator already landed the work, and the re-verifying iteration runs clean and ticks nothing — exactly the reported stall. The exclusion of bare top-level checklist runs (no linked subspec, nothing to name) is correct. No redesign is needed. The following refinements are required before this passes; all are precision/prose additions that do not change scope or the acceptance set materially.

**1. Give the operator-pointer acceptance criterion a verifiable anchor (highest priority).**
The criterion "points the operator at ticking those criteria if the work is done" currently grades intent, not an observable token, while the parallel dirty-worktree stop uses concrete greppable wording. As written, the name-criteria and point-the-operator criteria risk collapsing into "the message merely got longer," making them untestable. The spec must require a specific, greppable substring (or pin the exact pointer phrasing) for the operator pointer — mirroring how it already pins `made no progress; stopping` — so a test can mechanically confirm the pointer is present. Leave exact wording otherwise free.

**2. Pin the reachability precondition for the named-criteria case, and make the new test explicit.**
The spec leaves implicit that the index unchecked-count surface and the subspec criteria are different surfaces, and that the diagnostic only fires when an unchecked *linked subspec* is resolvable AND the worktree is clean (a dirty tree diverts to the dirty-worktree stop first; the clean case arises under `git: false`, work committed by a prior iteration, or an otherwise clean tree). State this precondition in one line so the name-criteria criterion is falsifiable. The spec must also make explicit that a new test exercises this linked-subspec state — every existing no-progress test uses a bare top-level task and therefore never reaches this branch, so without a new test the behavior is unverified.

**3. Name the snapshot source for the listed criteria.**
State that the named unticked criteria come from the same after-iteration acceptance-criteria snapshot the harness already computes for the active subspec, so the implementer does not re-derive criteria from a different read. One line.

**4. Pin the criteria block's placement relative to the existing bounded-tail dump and stop line.**
The no-progress path prints a bounded tail of recent agent output immediately before the stop line. The spec says "append" without fixing whether the criteria block lands before or after that tail and the stop sentence. Specify the ordering (the dirty-worktree stop places unmet criteria after the stop sentence with blank-line separation; matching that keeps the 40-line tail from interleaving awkwardly). One line.

**5. Fix the v1-behaviors.md documentation framing.**
This change adds a *net-new* entry: the existing catalog maps only the exit *code* for no-progress and has no bullet describing the stop message's contents. The doc-update instruction must drop the self-contradictory "existing-behavior baseline" / "now names" framing (a not-yet-shipped change is not a baseline and is not an in-place amendment) and instead instruct adding a fresh entry recording, plainly, that the no-progress stop names the active subspec's unticked criteria on the clean-run-but-no-tick path. `run-loop.md` is the correct home for the operator-facing stop description, recovery, and wording; keep it.

**6. Trim the substring-preservation rationale.**
The decision to keep the `made no progress; stopping` substring is sound on the operator-grep ground alone. The trailing "existing test greps for it" clause is weaker than stated: the existing grepping tests are all bare-task (state B) runs that stay on the unchanged generic line regardless of this change. Trim the rationale to the operator-grep reason to avoid a misleading justification.

**7. Add a one-line cross-reference disclaiming the out-of-scope sibling lever.**
This diagnostic is the recoverability half of a broader effort whose other half hardens the agent to always tick satisfied criteria. To keep the split auditable and prevent reviewer confusion between "agent failed to tick" (handled elsewhere) and "operator must tick to recover" (this spec), add a one-line cross-reference to that sibling intent and state plainly that the rules-hardening lever is out of scope here.

**Not upheld:** The concerns that the branch is effectively dead or that the spec solves the wrong case are rejected — the targeted state is reachable and is the documented reproduction; the empty/missing-criteria edges are already foreclosed by existing control flow, so the spec's decision covering them is already satisfied by construction and needs no expansion.