## Verdict: required refinements

### 1. Separate publication scope from pipeline handoff (mandatory decision)

The spec must state explicitly that **publication/commit** continues to use the configured durable directory (directory-shaped path), while **pipeline handoff** records per-file worktree-relative paths for N≥2. Tasks must name the publication vs handoff surfaces separately (mirroring the existing single-file split between publication helpers and handoff), not overload a single `specPath` return from landing that both publication and persistence consume today.

**Rationale:** Without this, an implementer can break publication, resume, or finalization while satisfying handoff ACs. This is the highest-priority ambiguity.

### 2. Choose and document run-row storage semantics (additive vs replacement)

The acceptance criteria require `downstreamInputs` on the step-0 entry run, but the spec does not define how that coexists with today’s `spec_path NOT NULL` / `setRunSpecPath` surface. The spec must pick one model and carry it through tasks and ACs:

- **Additive:** directory-shaped `specPath` retained for publication/resume **and** `downstreamInputs` added for pipeline; or  
- **Replacement:** multi-file runs store only `downstreamInputs`, with explicit tasks for every consumer that today reads `writeRun.specPath`.

**Rationale:** XOR vs additive drives resume, terminal publication, dispatch guards, and whether existing tests stay valid. Mixed signals in the current draft leave implementers to guess.

### 3. Task artifact type, dispatch copy, and carry-forward for multi-file handoff

Branch-keyed work already allows `downstreamInputs` on **stage artifacts** opaquely; this slice must complete the **intent handoff recording** seam through dispatch. The spec must task:

- widening `PipelineStageArtifact` (or equivalent) so multi-file handoff is a legal persisted shape;
- relaxing dispatch completion guards that currently require `entryRun.specPath`;
- updating `carryForwardArtifact` (and any terminal validation) so `downstreamInputs`-bearing artifacts are not dropped.

Dispatch must **copy** persisted entry-run handoff unchanged—not re-derive inputs.

**Rationale:** Recording on the entry run is insufficient if dispatch rejects or drops the artifact shape. Deferring fan-out execution does not defer making dispatch accept and copy multi-file handoff.

### 4. State scope honestly: recording-only until fan-out

The problem motivates plan failure, but this slice’s deliverable is **correct per-file handoff recording**, not end-to-end pipeline continuation. The spec must say explicitly that multi-file pipelines **still fail at plan resolution after merge** until the fan-out downstream-stages work consumes `downstreamInputs`. Name that forward dependency in prerequisites or decisions.

**Rationale:** Without this, operators and reviewers will expect pipelines to work. Prerequisites currently describe the *old* directory handoff behavior without sequencing the fan-out consumer.

### 5. Expand acceptance criteria for coverage gaps

Add or tighten ACs so every guarded behavior has a named failing-test surface:

| Gap | Required outcome |
|-----|------------------|
| Non-review-last path | Direct write-last landing (no review) persists the same multi-file handoff on the step-0 entry run |
| Single-file preservation (#2359) | Cite existing pinning tests (“stays green”) for N=1 `specPath` handoff, review-last, and idempotent re-land—not only `bun run test:v2` |
| “This landing only” | With unrelated files already in `ready-intents/`, N=2 from this invocation yields exactly those two paths—not a durable-dir glob |
| Multi-file idempotent re-land | N≥2 early-return re-land preserves the same `downstreamInputs` (parallel to #2359 single-file AC) |
| Resume/finalization | Depending on storage model (§2): either preservation AC citing existing resume tests, or explicit AC that durable-dir resume still works when `downstreamInputs` is present |
| Guard inversion | Name the test invert hook/checkpoint for the multi-file guard (not “inverting the multi-file guard” without a mechanism) |
| Path ordering | `downstreamInputs` order is pinned (e.g. matches landing/validation order) to avoid flaky tests |

**Rationale:** Spec guidance requires failing-test ACs for behavior changes, refactor preservation via test citation, and invert guards for new guards. #2359 established these patterns on the same seam; this change repeats the same risks.

### 6. Clarify handoff API and caller contract

The spec must state which helper(s) own multi-file pipeline handoff (new union-return helper vs extending `intentHandoffSpecPath`), and enumerate callers affected if landing return types split publication `specPath` from pipeline handoff fields (`landPublication`, `persistIntentHandoff`, review-last paths, tests).

**Rationale:** `intentHandoffSpecPath` returns `string` today; tasks that assign `downstreamInputs` to it are not implementable without an explicit API decision.

### 7. Align `intent.md` with the subspec

`intent.md` omits single-file preservation, publication-vs-handoff split, fan-out deferral, and end-to-end scope limits present in the subspec. Align decisions and prerequisites so intent alone does not mislead implementers.

**Rationale:** Intent/subspec drift violates the merge-first, single-source-of-truth workflow.

### 8. Documentation: recorded vs consumed

Beyond `workflow-runner.md` and `v1-behaviors.md`, document that multi-file `downstreamInputs` are **recorded** on completion but **not consumed** for plan resolution until fan-out—cross-reference `daemon-host.md` or equivalent so docs do not imply plan works after this slice.

**Rationale:** Branch-keyed docs already distinguish storage from consumption; this slice must not regress that distinction.

---

### Split decision

**Do not split** the subspec if refinements above land in one causal checklist (landing → persist → dispatch copy → preservation ACs), same boundary as #2359 on this seam.

**Split** only if the run-row storage choice (§2) requires a standalone persistence migration that cannot be tested independently of landing/dispatch behavior—in that case split into independently testable subspecs linked from `index.md`, with every original task and acceptance outcome assigned exactly once across replacements.

---

### Upheld without further action

Problem identification, “this landing only” scoping intent, run-row/artifact parity goal, dispatch-as-copy (not re-derive), deferral of fan-out execution and plan/implement landing reshaping, and harness-level AC naming where wire shape is the contract. N=0 out of scope; N=1 must not emit `downstreamInputs`.