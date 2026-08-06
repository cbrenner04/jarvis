Validating key claims in the codebase before issuing the verdict.
## Verdict: refinements required before merge

The spec correctly targets the gap (pipeline intent-stage re-dispatch skips `maybeResetStaleWorkspace`) and the right seam (`advanceWorkflowStage` before `dispatchPipelineStage`). One atomic subspec remains appropriate. The following gaps must be closed in the spec text before merge.

### 1. Dependency injection and refusal surfacing

The spec pins the call site and seam but not how `maybeResetStaleWorkspace` receives its inputs (`CliDeps`, `Io`, synthetic intent `parsed`, in-process `IpcClient`) from the daemon pipeline path. `PipelineExecutionDeps` today carries none of this.

**Required:** A decision recording that stale-reset preflight runs in-process against the same daemon (not loopback), with a minimal injected bundle on `PipelineExecutionDeps` or a nested hook, and that refusal maps to stage `failed` via `failureDetail.message` using the same operator-facing strings as CLI intent re-run — without calling `dispatchPipelineStage`.

### 2. In-scope re-dispatch scenario

Problem prose says "killed intent stage," but stale reset only runs on the pre-dispatch path in `advanceWorkflowStage`. That path is reached after failed-stage reopen/resume/continuation (including daemon-restart continuation), not while a stage row is still `running` with a stranded killed linked run (which today returns `stop`).

**Required:** Explicit in-scope/out-of-scope boundary: git-enabled intent stage re-dispatch after failed-stage continuation; out-of-scope stranded `running` + dead linked run. Align problem/AC framing with the task's "failed-stage pipeline continuation/re-dispatch" wording.

### 3. Workflow gating

The decision to gate on `workflow: "intent"` **and** `intent-reviewed` is garbled: pipeline stages author `workflow: "intent"` only; `intent-reviewed` is a resolved preset alias from review level.

**Required:** Gate on authored `workflow: "intent"`; pass canonical `"intent"` to `maybeResetStaleWorkspace`.

### 4. Scope boundaries the implementer could misread

**Required decision lines for:**
- **First dispatch:** preflight runs before every qualifying dispatch; no-op when no stale managed worktree exists (re-dispatch framing is the motivating case).
- **Fan-out:** linear `advanceWorkflowStage` only; fan-out resolution returns before the insertion point — explicitly out of scope.
- **Daemon→CLI coupling:** calling `maybeResetStaleWorkspace` from `stale-reset-workspace.ts` is intentional for gate parity with CLI intent re-run.

### 5. Test plan completeness

`pipeline-execution.test.ts` today uses in-memory stores and stub resolution — no git fixtures. The spec demands git fixture, managed worktree, production intent resolution, real stale-reset effects, and ordering proof before dispatch.

**Required:**
- Task/AC must name concrete harness sources to borrow (`materializeStaleWorktree` / git helpers from `workflow.test.ts`; intent resolution patterns from `pipeline-stage-resolve.test.ts`; failed-continuation drive pattern from existing `re-dispatches only the failed continuation stage` test).
- Align AC wording: assert worktree absent from `git worktree list` and verdict sidecars gone **at the dispatch boundary**; treat recreation as downstream of `start`, not a synchronous assertion in the pin.
- Add a **refusal-path** regression: seed a guard refusal (e.g. dirty tracked file), assert stage `failed`, dispatch not called, with a `// @mutate` on the refusal branch — per spec guidance that guards suppressing effects need negative pins.

### 6. Intent ↔ subspec alignment

`intent.md` drifts from the subspec on several contract items.

**Required sync in `intent.md`:**
- Preservation AC: `` `workflow.test.ts` — `"run workflow intent resets a stale worktree before daemon start"` stays green ``.
- `bun run test:integration:v2` in acceptance criteria.
- Runbook doc intent: pipeline auto-clears poisoned verdict trees when guards pass; retain `jarvis cleanup --abandon` for refused-guard and non-pipeline cases (not a global drop).
- Fix intent AC "removed and recreated" to match subspec dispatch-boundary semantics.

### 7. Documentation scope

Doc tasks must be **additive**: add pipeline re-dispatch stale-reset beside existing CLI intent prose in `daemon-host.md` and `operator-runbook.md`. Revise the stale-reset gap prose but **retain** documented deferrals for `prepareWorkflowSteps` (iteration bounds, review timeouts) — this slice closes stale-reset only.

### 8. Prerequisites (minor)

Prerequisites correctly enforce merge-first on the CLI sibling spec. Optional but useful: one-line cross-reference that intent CLI preflight dirty/landed-criteria gate semantics apply via the shared seam (pipeline slice uses default inputs, no override flags).

---

**Rationale:** Items 1–2 prevent implementers from inventing undeclared wiring or testing the wrong lifecycle path. Items 3–4 prevent incorrect gating and scope creep. Item 5 satisfies spec guidance (failing-test AC for new behavior, mutation checkpoint for both affirmative and refusal guards, agent-verifiable ordering proof). Items 6–7 prevent intent/subspec drift and doc over-correction. No seam change or subspec split is needed once these are addressed.