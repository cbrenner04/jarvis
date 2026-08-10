## Verdict — refine

Five upheld items. The design (member-aware selection predicate → existing selected-ancestor path → `stageRunsForExpansion` re-join) is sound and correctly sized as one subspec; no split.

### Required refinements

1. **AC2 names a guard this change does not create.** The criterion points its mutation at a "member-materialization guard," but the re-join path in `stageRunsForExpansion` is pre-existing and untouched by this spec's Decisions — its only guard is a null-invocation early return unrelated to branch nesting. Rewrite AC2 so its checkpoint targets the guard this change actually introduces: the member-match arm of the new selection predicate. A mutation checkpoint whose target text doesn't correspond to new code either fails to link or goes hollow at completion.

2. **Keystone and guard checkpoints must target distinct anchors.** AC1's keystone (revert run matching to the pre-fix identity comparison) and AC2's guard both plausibly land on the new predicate body — the same edit twice, so one is guaranteed to be inert or redundant. State the anchor split explicitly in Decisions: the keystone reverts the predicate itself; the guard checkpoint mutates a distinct site (e.g. the branch-site call). Also note that the two run-match call sites differ in their return expressions, so full-line anchors remain unique — the `@mutate` uniqueness rule is satisfiable but only if authored that way.

3. **The existing directive this change invalidates needs acceptance-criteria coverage, not just a checklist bullet.** A directive in `v2/src/tui/tui-monitor-pipeline-tree.test.ts:605` quotes the exact branch run-match line the predicate replaces; once replaced, its target text occurs zero times and completion refuses on any criterion that opens that file. The Task checklist is informational and the harness ignores it, so as written the only forcing function is a blocked run. Carry the repaired branch-ancestor pin into an acceptance criterion (branch-ancestor resolution stays pinned under the rewritten matching), and name the replacement anchor.

4. **Rule out ad-hoc collapsed groups explicitly.** `buildAdHocNodes` emits collapsed workflow rows through the same collapse helper but has no expansion path, and ancestor resolution walks pipeline nodes only — so a non-representative ad-hoc member reproduces the intent's problem and is unreachable by this fix. Deferring it is correct; leaving it unstated is not. Add a Decision ruling it out with that reason.

5. **AC3 needs a reachability citation.** The no-explicit-write invariant cannot go red on the current base — effective expansion already returns a fresh set and nothing writes the caller's set. Per the rule-out/invariant guidance, cite how the forbidden condition is reachable: the naive alternative implementation (writing the stage id into the caller-supplied expansion set from the reveal path) is exactly what the second Decision rules out. State that, and drop the "stays green" phrasing — this is a new test, not a preservation citation.

### Also fix (low cost, low severity)

6. **"Painted selected row" overclaims the seam.** Selection marking lives in the line renderer, outside this spec's scope; the projection determines it only by emitting a member-keyed node at the right depth. Reword AC1/AC2 to assert node materialization plus ancestor expansion so the criteria are verifiable within the module boundary the spec claims.

7. **Record the alias ruling.** The intent posits "either aliases onto the representative or points at an invisible id"; the spec silently narrows to the invisible case. That narrowing is right — marking is exact run-id equality, so no aliasing occurs — but say so in a clause so a reader sees it was checked rather than dropped.

### Out of scope — do not add

- **Cross-stage double-paint** (two explicitly expanded stages sharing an invocation both re-joining) is a real pre-existing defect this change neither introduces nor widens. Not an acceptance criterion here; it belongs in a separate wip-intent.
- **Operator-reachability framing.** Selection state is cleared for unselectable ids on the current base, so no keybinding reaches this today — but the spec already frames itself as a prerequisite for Enter-reveal and states the doc update as projection semantics. Nothing to change.