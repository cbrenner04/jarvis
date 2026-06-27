## Verdict: required refinements

**1. Unify the base-current implementation shape**

The Decisions entry to “reuse `checkBaseCurrent`” conflicts with the no-PR path: today’s helper soft-fails when `gh pr view` fails and never runs `getBaseBranch`. The spec must commit to one observable contract — extend the helper, extract shared ancestor logic, or add a triage-local wrapper — so PR and no-PR paths share the same verdict semantics (ancestor test, behind/diverged refusal, fetch soft-fail) without two implementers shipping different failure coverage.

**2. Pin pre-check order relative to the DRAFT guard**

Current `--mark-ready` order is completeness → DRAFT → commit/push. “Before any side effect” does not say where behind-base sits vs DRAFT. Pin it: after completeness, **before** the DRAFT guard (and before commit/push/gate/ready). That matches the intent (block stale gating early) and makes the operator path clear when both behind-base and non-DRAFT apply.

**3. Cover the no-PR behind-base path in acceptance criteria and tests**

The no-PR + `getBaseBranch` decision is load-bearing but AC 1 and the test task are PR-agnostic only. Add an AC and test task: complete worktree, no open PR, branch behind default base → non-zero exit, resolve-then-re-invoke message, no `ensureDraftPr`, gate, or `prReady`.

**4. Pin happy-path tests to the new check**

Preservation AC (“`triage-command.test.ts` stays green”) does not prove the no-PR check runs — existing no-PR happy tests (`getPrState: () => null`) lack base-current injection and could stay green if the check soft-fails or is skipped. Require explicit `current` (or equivalent) injection on existing no-PR happy-path tests; name the “no PR exists opens draft PR” test as a preservation anchor once injection is wired.

**5. Refusal must block push on clean trees with unpushed commits**

`commitAndPushFinalizeDirtyWorktree` pushes unpushed commits on a clean tree without a new commit. AC 3 only pins uncommitted dirt. Extend refusal coverage: behind base on a clean tree with unpushed commits → no push, gate, or ready flip.

**6. Narrow AC 4’s soft-fail claim**

AC 4 (“failure to resolve or fetch”) overstates symmetry. On the PR path, `gh pr view`/fetch failures soft-fail; on the no-PR path, `getBaseBranch` always returns a string (existing fallback). Narrow the AC or add a decision line: no-PR proceed-on-uncertainty applies to fetch/ancestor git errors only, not base resolution.

**7. Document soft-fail proceed in `v2/docs/v1-behaviors.md`**

Doc updates cover refusal only. AC 4’s proceed-when-uncertain behavior must appear in the `--mark-ready` entry for parity with the patch/plan draft→ready soft-fail note already in that catalog.

---

**Rationale:** Items 1–2 remove implementer fork points that could ship partial or misordered guards. Items 3–5 close test/AC gaps on the no-PR and unpushed-commit paths the spec’s decisions already commit to. Items 6–7 align behavioral claims with existing `checkBaseCurrent`/ready-flip semantics and `documentation-standard.md` (behavior changes update the durable catalog).

**Optional (not blocking merge):** soft-fail proceed test in triage; decision lines for diverged sharing the “behind” message and intentional message divergence from ready-flip guard wording; tie unit-test scope in `base-current.test.ts` to the shape chosen in item 1.
