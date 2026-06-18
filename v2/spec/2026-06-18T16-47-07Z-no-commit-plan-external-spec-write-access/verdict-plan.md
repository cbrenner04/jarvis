I'll verify the key claims against the codebase before issuing my verdict, since the findings hinge on specific file locations and call sites.Confirmed: no `v1/src/modes/plan/plan.ts`; the orchestrator is `v1/src/commands/plan.ts`. Let me verify the producer wiring and call sites.Several key claims are confirmed, but I notice something important the advocate and adversary both missed. There's a `runPlanReviewPhase` in `review.ts` (not the shared `review/run.ts` runner), and there's already an `assertNoCommitExternalSpecBoundary` + `appendBoundaryBlocker` machinery at `plan.ts:941-954`. Let me examine the draft phase, the existing test, and the actual review flow more carefully.This is a critical finding. There's already an `assertNoCommitExternalSpecBoundary` machinery that checks the external spec dir for boundary violations, and `draft.ts` already accepts `agentCwd`. Let me look at the existing no-commit draft test and the boundary assertion to understand what's actually happening.Now I have a much clearer picture than either the adversary or advocate. Key findings:

1. `runDraftPhase` already accepts `agentCwd` (`draft.ts:24`), defaulting to `worktreePath`. Production does NOT pass `agentCwd` (`plan.ts:866-877`), so the agent runs with `cwd = worktreePath = project.root`.
2. `runPlanReviewPhase` (in `review.ts`) already accepts `agentCwd` (`review.ts:322`) and passes `cwd: opts.agentCwd ?? opts.worktreePath` to `runReview` (`review.ts:806`).
3. There's an existing `assertNoCommitExternalSpecBoundary` boundary-check machinery (`plan.ts:940-942`), and a `appendBoundaryBlocker` (`plan.ts:954`) — so the harness already detects whether files landed outside the boundary.
4. None of these `agent.run` sites currently thread `additionalReadDirs`.

Let me confirm the existing test, the review.ts `agentCwd` wiring, and verify whether `verdict-actuator` receives the dir.Now I have a complete, verified picture. The existing test at `spec-dir.test.ts:98` does pass `agentCwd: specDir`, which masks the production bug — production omits `agentCwd` (`plan.ts:866-877`), so the agent runs with `cwd = worktreePath = project.root`. The `FakeAgent` writes to `specDir` regardless and has no sandbox boundary.

Critically, both the advocate and adversary referenced a nonexistent `runVerdictActuator` being called from the producer with `additionalReadDirs` — but the actual verdict-actuator is invoked *inside* `review.ts` via `createPlanReviewAdapter`, not directly from `commands/plan.ts`. Let me confirm how the actuator is reached and whether `additionalReadDirs` would need threading through the adapter.I now have a fully verified picture. The verdict-actuator runs `agent.run({ cwd: opts.worktreePath })` (`verdict-actuator.ts:164-166`) — it has `externalSpecRoot`/`specDirPath` but no `additionalReadDirs`, and it runs with `cwd = worktreePath`. The shared review runner runs `agent.run({ cwd: opts.cwd })` (`run.ts:97`) with no `additionalReadDirs`.

Both the adversary's and advocate's central findings (#1 filename, #2 verifiability) are confirmed and load-bearing. I have enough to issue the verdict. Let me write it.

---

# Verdict — `2026-06-18T16-47-07Z-no-commit-plan-external-spec-write-access`

The design is sound and approved: reuse patch-mode's `additionalReadDirs` → `--add-dir` vector, keep `cwd = project.root`, gate on `commit === false`, wire draft/review/verdict-actuator, exclude the resume path. No design rework required. The spec is **under-specified on where the code lives and how its acceptance criteria are proven**. The following refinements are required before this spec is fit to implement.

## Required refinements

### 1. Correct the producer location and reframe "compute" as "forward". (Upheld — blocking.)

The subspec repeatedly names a file that does not exist: there is no `v1/src/modes/plan/plan.ts`. The plan orchestrator is `v1/src/commands/plan.ts`. Worse, the spec's Tasks instruct the implementer to "compute the no-commit external spec dir in `plan.ts`," but that dir is *already computed* in the orchestrator (`finalSpecPath`) and *already* partly threaded into the review phase. An implementer following the spec literally will hunt for a nonexistent file and risk re-deriving a value already in scope.

The spec must:
- Name the correct orchestrator file (`v1/src/commands/plan.ts`).
- Reframe the producer work as **forwarding the already-computed external spec dir as `additionalReadDirs`** at the live draft and fresh-review call sites — not computing it.
- Identify the three `agent.run` sites that must receive `additionalReadDirs`: the draft phase, the shared review runner reached via the plan review phase, and the verdict-actuator. Note that the verdict-actuator is reached *through* the plan review phase's adapter, not invoked directly from the orchestrator — the spec's current "wire draft/review/verdict-actuator from the producer" framing misrepresents the call graph and must be corrected so the threading path is accurate.

Rationale: a spec that points implementers at the wrong file and overstates the change is a precision defect that will produce wrong or wasted work. Spec guidance for harness subspecs permits naming internal symbols precisely; this spec must do so correctly.

### 2. Name the proof mechanism for every acceptance criterion; require the test to drive the production call path. (Upheld — most important, blocking.)

The acceptance criteria as worded are not verifiable with the available test harness. Two confirmed facts make this acute:

- The existing no-commit draft test passes the spec dir as the agent's working directory (`agentCwd: specDir`), but production does **not** pass `agentCwd` — it defaults to `worktreePath` (= `project.root`). The existing test therefore does not reproduce the production condition at all; writes "succeed" trivially because the fake agent is handed the spec dir as its cwd.
- The fake agent has no sandbox boundary. A fake agent cannot exercise a real `--add-dir` write boundary, so criteria phrased as "write boundary exercised on the blocker path" are literally unachievable.

The spec must:
- Replace every "proven by a regression test" / "write boundary exercised" phrasing with the **concrete, established proof mechanism**: assert that the captured `agent.run` options contain the external spec dir in `additionalReadDirs` for each of the three phases under `commit: false`, and that they do **not** under `commit: true`. This mirrors the patch-mode test pattern already in the codebase.
- Require the new regression test to **drive the production call path** — i.e., not pass the spec dir as the agent's working directory — so the test reflects the real `cwd = project.root` condition the change fixes. A test that hands the agent the spec dir as cwd proves nothing about this fix.
- Reword the blocker-path criterion accordingly: with a fake agent, the only honest signal is that `additionalReadDirs` containing the external spec dir reached `agent.run` on the blocker path, not that a write grant enabled the append.

Rationale: acceptance criteria must describe verifiable observable behavior. Criteria that can be "satisfied" by a test that does not reproduce the bug are worthless as a gate and violate the spec-guidance contract that criteria be checkable.

### 3. Make the `commit: true` "unchanged" guarantee concrete and three-phase; pin the shared-runner non-leak. (Upheld — blocking.)

The review runner (`RunReviewOptions`, its single `agent.run`) is genuinely shared between plan review and patch review. Adding an optional `additionalReadDirs` field that plan populates must not leak into patch review. The current criterion 5 only asserts the *plan* `commit: true` case and says nothing guarding patch review.

The spec must:
- Extend the `commit: true` criterion to cover **all three plan phases'** `agent.run` options carrying no plan-spec `--add-dir` directory.
- Promote the existing decision text "patch review leaves it unset" into a **checkable acceptance criterion**: patch review must leave the shared runner's `additionalReadDirs` option unset.

Rationale: "unchanged" must be proven, not asserted, precisely because the runner is shared — an untested optional field on a shared path is exactly where regressions hide.

### 4. Add a one-line load-bearing justification for excluding the resume path. (Upheld — should-fix.)

The spec lists "the resume path" under Out of scope but does not say *why* excluding it is safe. The resume path forces `commit: true` and is git/worktree-based, so a no-commit run can never reach it — gating `additionalReadDirs` on `commit === false` at the orchestrator call sites is therefore sufficient. Without this line, a reviewer cannot tell whether resume was excluded deliberately or overlooked (resume also drives the review phase).

The spec must add one line naming the invariant that makes the resume exclusion safe. Rationale: this repo's ledger discipline requires an out-of-scope exclusion that rules out a plausible-wrong-alternative to name the invariant that justifies it; here the alternative is "you forgot resume also runs review."

### 5. Record the claude/codex-only write semantics in the documentation updates. (Upheld — should-fix, doc accuracy only.)

`--add-dir` grants *write* access only for claude (`acceptEdits`) and codex (`workspace-write`); cursor and opencode accept and drop the directories, and aider passes them positionally. The default plan agent order is claude-only, so this is latent, but an operator with a non-default `modes.plan.agentOrder` would get a no-commit plan that still cannot write under those agents.

The spec must add a one-line accuracy note to the `v2/docs/v1-behaviors.md` documentation update recording that the write grant is claude/codex-only and cursor/opencode accept-and-ignore. Do **not** expand scope to make cursor/opencode writable — the intent explicitly rules out broad sandbox-policy changes, and this is an inherited limitation of the patch-mode prerequisite, not a regression introduced here.

## Out of scope (confirmed; no action)

- Making cursor/opencode honor `--add-dir` writes — explicitly excluded by intent.
- Changing default `modes.plan.commit`, reworking v2 intent flow, or broad sandbox policy.

Net: approve the design; require wording corrections to (a) name the real code location and the true call graph, (b) replace unverifiable criteria with the assert-`additionalReadDirs`-reaches-`agent.run` mechanism and force the test onto the production path, (c) make the `commit: true` non-leak guarantee checkable across all three phases, (d) justify the resume exclusion in one line, and (e) record the agent-specific write-grant limitation in docs. No scope expansion.