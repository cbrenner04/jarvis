Verifying key codebase claims so the verdict reflects actual seams and scope.
## Verdict: required refinements

### 1. Scope gate before implementation (blocking)

The spec must treat successor-kind confirmation as a **blocking outcome**, not background task work. After locating dispatch paths and where pre-agent stalls escape existing watchdogs, the decision ledger must record which successor kinds actually match the stall model (durable row, `iteration_started`, then silence, no idle bound today).

**Required outcomes:**

- **Publication** must not stay framed as a third peer successor run row if the completion tail settles on the write or `~shrink` row (shared `lastResult.runId`). Either drop publication from repro/AC scope or reframe it as tail stall on an existing row—with distinct arming trigger if `iteration_started` is absent.
- **Shrink** must be explicitly ruled in or out: if dispatch already enters `executeWriteLoop` with idle-output and wall watchdogs, shrink must not require redundant workflow-runner coverage; scope limits to any **pre-`executeWriteLoop`** stall only if one exists.
- **Review-debate** must be explicitly in scope or explicitly deferred with rationale. The ledger already requires `iteration_started` before arming for durable rows that omit it; that path creates a durable row without `iteration_started` today and is inconsistent with AC#1, which only covers successors that already log the event.

If task-1 outcomes leave multiple genuinely independent implementation paths (e.g. standard review shell watchdog, review-debate `iteration_started` + watchdog, daemon claim release), **split into independently testable subspecs** linked from `index.md`, each owning its tasks and acceptance outcomes once—no prose compression. A single subspec remains acceptable only if scope collapses to one confirmed seam plus verifiable claim release.

Restore tentative language on candidate loci where the ledger currently reads decided; hypothesis confirmation is part of the scope gate.

### 2. Fix AC#1 failing-test contract

AC#1 conflates test expectations with code under test (“watchdog armed on pre-fix code”). Rewrite to the standard pattern: **the named test fails against pre-fix code and passes after the fix**, pinning live/unbounded behavior until the watchdog lands. Do not require three peer successor rows unless scope gate confirms three distinct stall models.

### 3. Pin full terminal settlement projection

Choosing `role_stalled` is insufficient as AC wording. The spec must state the **operator-visible contract** on idle-budget exhaustion:

- Terminal non-live row and `loop_finished` with stall-class outcome
- `run list` / `run wait`: `error.reason: "role_stalled"` with `failureKind: "stall"`, `resumable`, `retryable`, and `nextAction` aligned with existing post-commit review stall behavior (`preserve-committed-work-when-review-step-stalls`)
- Behavior when **no role was invoked** (pre-agent shell stall): whether `invocationFailureDetail` is present and what it carries

Without this, implement can satisfy weak “stall-class outcome” wording while diverging from operator expectations.

### 4. Shell watchdog lifecycle decisions

Add explicit decisions for the successor **shell** layer (between `iteration_started` and first role invocation):

- **Handoff:** cancel/disarm the shell idle watchdog when the first role invocation begins (review `invokeReviewRole` entry, shrink handoff into `executeWriteLoop`, review-debate `onRoleStart`) so shell and role-layer watchdogs do not double-settle or race.
- **Reset semantics:** what counts as “output” for the shell timer before spawn—typically the shell budget does **not** reset until first role invocation (or first agent stream progress); incidental log events after `iteration_started` must not reset unless explicitly decided.

### 5. Idle-budget semantics (explicit fork from write path)

The task checklist mixes write-step and review-role semantics. The spec must **explicitly choose** successor-shell idle budget rules:

- Review-role semantics: absent key → 90 s default (`DEFAULT_IDLE_OUTPUT_TIMEOUT_MS`), `0` disables at the layer that honors it
- Write-path semantics: absent/`0` → idle watchdog disabled, distinct `idle_output_timeout` settlement

The ledger must state successor shell uses **review-role idle budget semantics**, not write-path `idle_output_timeout`, and resolve absent-key behavior at the shell layer. Optionally add an AC for `idleOutputTimeoutMs: 0` disable (or accept decision-only risk).

### 6. Claim-release verification harness

Branch-claim release is an operator outcome but is not proven by execution-layer settlement alone. The spec must specify **where** claim admission is verified—e.g. daemon integration using `heldLiveBindingFactory` / `makeIpcClient` stale-reset helpers and `check_workflow_start_claim`, or a split subspec for daemon claim release. Naming the RPC in AC#2 without harness placement leaves implement to invent IPC wiring.

Trace claim release through terminal successor settlement → daemon/registry unwind (or require a daemon-level test that would fail if unwind does not run).

### 7. Mutation checkpoint vs deferred placement

AC#3 pins `// @mutate` on an arming guard in `workflow-runner.ts` while the ledger defers helper shape/placement. Resolve the tension: either pin mutation to a **stable one-liner call site** guaranteed to remain in `workflow-runner.ts` at the successor dispatch boundary, or defer the mutation path/file pin until implement knows where arming lives. A premature file pin risks `target_absent` (same class of failure as `implement-completion-honesty`).

### 8. Test practicality

Require synthetic fixtures to pin a **short idle budget** (machine override or harness), consistent with `write-loop-idle-watchdog.test.ts` (~20 ms), so CI does not wait on the 90 s default.

Cite a concrete held-live / synthetic repro pattern (`heldLiveBindingFactory` in `daemon-workflow-start.test.ts` or equivalent); weaken the `implement-completion-honesty` prerequisite to “synthetic repro discipline” rather than implying shared fixtures from that bundle.

### 9. Explicit out-of-scope boundaries

Add explicit exclusions so the watchdog does not spread to every `iteration_started` emitter: `finishReviewedLanding`, resume finalization paths, `replayMutationFinalization`, and other landing/resume/finalization sites outside implement successor dispatch after write-step settlement. Write-step watchdogs and `jarvis run kill` classifier gate remain out of scope.

### 10. Documentation parity

Documentation updates must cover at least **`v2/docs/daemon-host.md`** (operator error projection for the new/changed `role_stalled` path), in addition to `operator-runbook.md` and `v1-behaviors.md`. Write-path idle watchdog updated multiple doc surfaces; parity baseline requires recording behavior changes in `v1-behaviors.md`.

### 11. Intent ↔ spec alignment

After scope gate, align **intent** with refined successor kinds (publication row semantics, shrink inclusion/exclusion, review-debate inclusion/deferral). Intent still lists publication as a peer successor and omits review-debate; the spec ledger mentions review-debate without intent/AC coverage.

---

**Rationale:** Spec guidance requires behavioral ACs verifiable in the worktree, failing tests against pre-fix code for runtime behavior changes, mutation checkpoints with valid linked directives, agent-verifiable claim-release outcomes with specified harness, behavior changes recorded in `v1-behaviors.md`, and atomic independently testable subspecs when multiple seams are conflated. The operator pain (live successor wedging `(project, branch)`) is real; refinements above tighten seam accuracy, settlement contract, and verification so implement does not ship redundant shrink coverage, miss review-debate, or pass store-only tests without fixing branch claims.