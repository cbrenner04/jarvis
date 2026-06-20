## Verdict

The spec contains real, durable value in two mechanisms — the `off` switch (subspec 00) and skipping the contract `bun run test` re-run when shrink produces no file changes (subspec 01). Both are independent of the tooling ladder and should be preserved. The tooling ladder itself, as specified, has a blocking premise defect and several specification gaps. Required refinements below.

### Blocking

1. **The tooling pre-pass duplicates work the completion gate already commits.** The post-completion ready gate runs a repo-wide `bun run check:fix` and commits the result (`chore: apply pre-ready check:fix`) on a clean tree *before* shrink runs, and the shrink-eligibility guard is identical to the completion-gate guard. Biome is idempotent, so an allowlist-scoped `check:fix` re-pass in the shrink phase is a guaranteed no-op in any real run: `tooling` would commit nothing and `both` would always collapse to `agent`. Subspec 01's `tooling` acceptance criteria (allowlisted files have a `check:fix`-fixable issue → fixes applied and committed) therefore describe a state only reachable by a synthetic test that bypasses the completion gate — grading dead behavior. The spec must resolve this, not restate it. Two acceptable outcomes:
   - **(a)** Replace `check:fix` in the pre-pass with a concrete deterministic transform the completion gate provably does *not* already run, and stop describing it as `check:fix`; or
   - **(b)** Collapse the ladder to `off | agent` and keep the no-change test-skip, dropping `tooling`/`both`.
   The refinement must pick one and make every affected decision, task item, and acceptance criterion consistent with it. Per the quality bar, acceptance criteria must grade observable behavior reachable in a real run, not a state constructible only by circumventing the harness.

2. **The prerequisite is mislabeled.** The spec's only tier-dependent claim ("Harness exposes callable fast and full ready tiers for shrink contract test skipping") does not match what either subspec does: the test-skip keys off "shrink produced no file changes," which is unrelated to ready tiers. Reword the prerequisite to the behavior actually depended on, or drop it.

### Specification gaps (apply only to whichever mechanism survives refinement 1)

3. **Recorded green-result staleness after a shrink commit.** A new `shrink:` commit moves HEAD past the green result recorded by the completion transition, which is reused by the pre-shrink gate, review, and the ready-marking step. The spec must state that any tooling-path commit refreshes that recorded result through the same path the agent shrink commit already uses, so no downstream consumer reuses a green keyed to a now-changed tree.

4. **Guard-snapshot ordering.** The AC-regression baseline and the revert-to-baseline reference are currently captured after the pre-shrink gate. For a deterministic pre-pass's regression and scope guards to be meaningful, the spec must pin that these baselines are captured *before* the pre-pass mutates the tree.

5. **Scope-restriction invocation.** "Restricted to the allowlist" currently only rules out *committing* out-of-scope churn, relying on the scope guard to clean up after a repo-wide run. The spec should pin the invocation form (explicit allowlisted paths vs. repo-wide-then-revert) so the restriction is a property of the run, not only of cleanup.

6. **Distinct commit message.** The agent path commits `shrink: simplify implementation diff`. If a tooling path survives, give its commit a distinct message so the "no agent invoked" criterion is verifiable from git alone.

7. **`check:fix` non-zero exit.** One line on the unfixable-lint branch in the pre-pass (near-impossible given the upstream gate, but currently unspecified).

### Non-issues (no change required)

- Subspec 00 grading `both` as "preserves today's behavior" is the correct contract at 00's boundary; 01 redefining `both` is normal incremental layering.
- The deliberate choice to emit no `patch_phase: "shrink"` telemetry row for a tokenless pass is an accepted decision, not a defect.

If refinement 1 takes option (b), gaps 3–7 dissolve with the ladder and only 1 and 2 need action.