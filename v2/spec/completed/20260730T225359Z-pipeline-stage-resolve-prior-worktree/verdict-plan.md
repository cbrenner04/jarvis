Verifying key code claims so the verdict is grounded in the actual resolution and test harness behavior.
## Verdict: Required refinements

### 1. Resolve scope vs. outcome mismatch (blocking)

The intent promises operator-visible success: chained plan/implement resolution works with artifacts only on prior stage worktrees, without merged PRs on `main` and without copies in the operator checkout. Subspec 00 scopes only `pipeline-stage-resolve.ts`, `pipeline-execution.ts`, and unit tests.

That surface is insufficient. Preset builders resolve the project via `findProjectMatch(input.cwd, registry)`, which only matches paths under the registered project root — external worktrees at `~/.jarvis/worktrees/...` will not match. Implement preflight runs `isSpecAvailableInBaseRef` against the project root and `baseRef` (defaulting to the default branch name), so a plan spec that exists only on an unmerged plan worktree will fail even if `cwd` is corrected.

**Required outcome:** The spec must either (a) expand scope to cover whatever seams are needed for real preset-builder success on external worktrees (project resolution + implement handoff/preflight), or (b) narrow intent- and subspec-level acceptance criteria to “resolution threads prior worktree as preset `cwd`/`specPath`” and defer composed real-builder pipeline success to a named follow-on intent. The spec must not land claiming full git-enabled inter-stage handoff if only the resolution layer changes.

---

### 2. Pin the implement chained-handoff contract (blocking)

Subspec 00 decides chained implement `resolveBaseRef` runs against the prior entry run worktree but does not define what value it returns or how implement preflight should behave when the plan spec is absent from `main`.

**Required outcome:** A concrete, testable contract for chained implement resolution: what `baseRef` is (e.g. prior entry-run branch, `HEAD`, `specRef`, or other entry-run field), what root `isSpecAvailableInBaseRef` runs against, and whether pipeline resolution supersedes or relaxes that preflight when the artifact is already validated on the prior worktree. Without this, subspec 00’s implement AC and subspec 01’s composed e2e are likely infeasible with current `implement-workflow-steps.ts`.

---

### 3. Align subspec 01 harness fidelity with its decisions (blocking)

Subspec 01 requires production `resolveStage` with real preset builders and rules out stubbing `readReadyIntent` or pre-seeding operator-checkout artifacts. The existing e2e harness overrides `readReadyIntent` to read from `sandboxRepoRoot` (operator checkout) and stubs `resolveProjectMatch` to `{ root: cwd }`, which can pass while inter-stage read-root logic is wrong.

**Required outcome:** Subspec 01 must require harness changes that remove or narrow these overrides for the `fast` case so the test actually exercises chained read-root behavior. The task checklist must name this explicitly; decisions alone are not enough.

---

### 4. Split or expand if preset-builder work is in scope

If refinement chooses scope expansion (refinement 1, option a), preset-builder / project-match / implement-preflight work is a distinct module boundary from daemon resolution.

**Required outcome:** Add an independently testable subspec (linked from `index.md`) owning that surface, or fold it into an expanded subspec 00 with acceptance criteria that prove real-builder success — not only `cwd` threading via fake builders. Every original intent acceptance outcome must appear exactly once across subspecs.

---

### 5. Complete the `stageArtifacts` migration contract

Replacing `artifactSpecPaths: Map<string, string>` with full `PipelineStageArtifact` objects touches more than the two files named in subspec 00. `carryForwardArtifact` today strips to `specPath` only via `extractArtifactSpecPath`, dropping `entryRunId` on resume/replay.

**Required outcome:** Task checklists must enumerate all affected call sites (resolution, execution loop, carry-forward, e2e harness, related tests including `workflow-runner.test.ts` pipeline handoff coverage, and any `resolveStage` type wiring). Carry-forward must retain full artifacts (or equivalent keyed structure), not spec paths alone.

---

### 6. Specify subspec 01 admission and settlement assertions

Subspec 01 asserts terminal settlement but does not define `terminalAction` for the `fast` definition or what “settlement” means for a pipeline with no approval gates and no terminal publication.

**Required outcome:** Name the admission config (`terminalAction`, project pipeline binding) and the concrete success assertions for the `fast` case (e.g. all workflow stages `succeeded`, derived pipeline state reaches expected terminal status).

---

### 7. Align verification gates across intent and subspecs

Intent AC requires `bun run test:v2`; subspec 01 AC requires only `bun run test:integration:v2`. The e2e file runs under integration, not unit `test:v2`. An implementer completing subspec 01 per its ACs does not satisfy the intent gate.

**Required outcome:** Partition verification so every intent-level gate is satisfied by exactly one subspec’s acceptance criteria, with no gaps or contradictions.

---

### 8. Tighten acceptance-criteria wording

Several ACs overclaim or use non-verifiable phrasing:

- “Git-enabled intent/plan stage succeeds” in subspec 00 implies publication/materialization, but proposed tests use manually constructed artifacts and fake builders — they prove `cwd` threading, not git-enabled dispatch.
- “Fails against baseline, then” is author workflow, not an agent-verifiable outcome per spec guidance.

**Required outcome:** Rephrase ACs to name the test file, the observable behavior it proves (e.g. preset input `cwd` equals prior entry-run worktree), and guard-inversion failure — without implying git publication or baseline-process steps the harness does not enforce.

---

### 9. Add preservation criteria for the API refactor

Renaming the core resolution parameter without preservation ACs risks regressions in approval-skip, first-stage seed, and `leave-draft` skip-ready behavior already covered in `pipeline-stage-resolve.test.ts`.

**Required outcome:** Cite-style preservation ACs in subspec 00 naming existing tests that must stay green after the `stageArtifacts` migration.

---

### 10. Clarify fixture layout policy for subspec 01

Production worktrees live under `JARVIS_HOME/worktrees/...`; the e2e harness uses repo-nested `.jarvis-worktrees/`, which is more forgiving for `findProjectMatch` because paths remain under `project.root`.

**Required outcome:** Subspec 01 must state whether repo-nested worktrees are the intentional integration surrogate or whether fixtures must use production layout. If surrogate, docs or decisions should note that production `~/.jarvis/worktrees/...` layout proof is out of scope or deferred.

---

### 11. Document `full-review` e2e limitation

After adding the `fast` case, two e2e paths will differ in fidelity: `full-review` still pre-seeds operator-checkout artifacts.

**Required outcome:** Subspec 00 documentation updates should note that `full-review` e2e is not the inter-stage worktree handoff proof; the `fast` case (subspec 01) is.

---

### 12. Low-priority but recommended pins

- One negative unit test for hard-error paths when artifact, `entryRunId`, entry run, or `worktreePath` is missing (decision exists, no AC).
- One-line decision for directory `specPath` at plan resolution (fail closed with clear error).
- One-line out-of-scope note for in-flight pipelines with legacy specPath-only artifacts on resume.

---

## Rationale

The problem diagnosis and resolution-layer design (`stageArtifacts` + `store.loadRun` + prior worktree `cwd`) are sound and match the code. The gap is between that slice and the intent’s operator-visible acceptance criteria: composed pipeline success through real preset builders requires at least project resolution and implement preflight seams that the current subspec boundaries omit. Spec guidance requires failing-test ACs for runtime behavior, guard inversion for new guards, agent-verifiable criteria, and atomic subspecs at module boundaries — all of which push toward either an honest scope split or an expanded, testably partitioned spec. Landing without resolving refinements 1–3 risks a spec that passes unit `cwd`-threading tests while production pipeline handoff remains broken.