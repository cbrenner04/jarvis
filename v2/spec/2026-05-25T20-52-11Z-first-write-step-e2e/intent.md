---
name: first-write-step-e2e
---

# Intent

Draft the next implementation spec from [`v2/spec/v2-meta-index.md`](../v2-meta-index.md): "First write step, end-to-end."

This is the first v2 spec after the scaffold work. The point is to
prove the real execution path once, from the v2 CLI down to a materialized
worktree result, without pulling the loop, daemon, workflow runner, or durable
state forward.

The intended slice is narrow:

- one `write` step
- run exactly once from the v2 CLI
- host-agnostic execution core behind the CLI host
- prompt render -> agent invocation -> outcome capture -> output-contract check -> worktree write
- quota fallback in the invocation layer

The spec should preserve the sequencing in [`v2/docs/v2-build-order.md`](../../docs/v2-build-order.md):
This is the first working step, not the first version of every later system.
Anything that exists only to support looping, resume, detached execution,
cross-step workflows, or PR automation belongs to a later phase unless this phase
needs a tiny seam to avoid painting us into a corner.

Likely shape of the spec:

- an index with a small number of atomic subspecs, probably around:
  - core run contract and CLI entry for a single write step
  - agent invocation and quota fallback
  - worktree materialization and deterministic output-contract enforcement
  - minimal docs for how the new v2 path behaves

The draft spec should make the this phase's boundary explicit:

- no loop
- no SQLite or other durable run state
- no daemon host or IPC
- no TUI
- no multi-step workflows
- no PR lifecycle work

Important design constraints to carry into the real spec:

- Keep the execution engine honest as a library boundary from day one. The core
  run path should be callable without the CLI owning global process state.
- Cancellation should work through `AbortSignal`, even if we only proves a
  thin version of that contract.
- The CLI should stay a thin host over the core, not the place where execution
  logic accretes.
- Persistence for this phase is the worktree plus git state only. If metadata
  needs to exist, it should be the minimum needed for the single-run contract,
  not a premature resume system.
- Quota fallback is in scope because this is where the first real agent
  invocation lands.
- The output contract should be deterministic and inspectable. A run
  must have a clear machine-checkable result, not just "the agent ran."

Questions the real spec should answer tightly:

- What exact CLI surface exposes the one-shot write step in v2?
- What is the minimal output contract for a successful write step?
- Where does the rendered output land in the worktree, and what repository
  invariants must hold before and after the write?
- What constitutes an invocation outcome for fallback purposes?
- What must be logged or surfaced to users now, versus deferred until structured
  logging exists?
- Which pieces of v1 prompt assembly or agent plumbing can be reused directly,
  and which need a v2-local seam to keep cross-tree boundaries intact?

Risks to keep visible while refining:

- accidentally smuggling resume/state concerns into this work
- letting the CLI contract sprawl before there is a loop runner
- overdesigning the library boundary before the first real caller exists
- under-specifying the output contract, leaving success/failure ambiguous
- coupling this work too tightly to one agent implementation so fallback becomes a
  retrofit

Documentation for the eventual spec should stay small and concrete. Prefer
updating the v2 docs that describe build order, architecture, or operator
surfaces only where the implemented behavior makes those docs stale.
Avoid writing broad usage docs for future phases.

## Refine turn 1

- Keep the implementation spec phase-scoped to Phase 1 from [`v2/docs/v2-build-order.md`](../../docs/v2-build-order.md); do not restate later-phase behavior except as explicit exclusions.
- Split the draft into atomic subspecs by executable seam, not by layer names.
- Prefer three subspecs unless repo evidence forces four; index overhead beyond that is likely spec churn, not clarity.
- Subspec 1 should pin the one-shot CLI surface and host-agnostic core contract together; the boundary is only useful once one real caller proves it.
- Subspec 1 should define the minimal run inputs and outputs as TypeScript contracts, including `AbortSignal` threading and machine-checkable success/failure outcome.
- Deferred to first consumer: exact exported symbol names for the core runner and CLI adapter — pin when a caller needs it.
- The CLI surface should expose one narrow command path for a single write step and explicitly reject loop/workflow/resume flags in this phase.
- Deferred to first consumer: final human-facing command spelling beyond the single implemented path — pin when operator ergonomics are exercised.
- Subspec 2 should cover agent invocation outcome taxonomy and quota fallback policy as one independently testable slice.
- Invocation outcomes should distinguish at least success, quota-exhausted-retryable, non-retryable failure, and cancellation; fallback semantics depend on that split.
- Deferred to first consumer: richer failure classes beyond what fallback selection and user surfacing need — pin when another caller consumes them.
- Quota fallback should stop at the first successful invocation and should not introduce policy/config surfaces reserved for Phase 5.
- Reuse from v1 is allowed only behind v2-local adapters; no direct cross-tree imports per the scaffold boundary.
- The spec should call out any copied v1 logic that must become v2-owned now versus any shell-out seam that can remain thin for Phase 1.
- Subspec 3 should cover worktree materialization plus deterministic output-contract enforcement as one artifact-boundary slice.
- The output contract should be defined in terms of observable filesystem/git invariants, not agent self-report.
- Success should require both a valid output artifact contract and a materialized worktree result; "agent exited 0" alone is insufficient.
- Deferred to first consumer: whether the contract validates exactly one artifact path or a small fixed set — pin when the first step schema is written.
- Worktree persistence is the only run persistence in scope; any metadata file must justify itself as necessary to evaluate the single-run contract.
- The spec should forbid SQLite, resumable run identifiers, daemon-owned logs, and background lifecycle hooks in acceptance criteria, not only prose.
- Cancellation coverage should prove abort propagation through the core contract and invocation layer; signal ownership and terminal UX stay deferred.
- Deferred to first consumer: exact interrupt-key handling and process-signal wiring in the CLI host — pin when foreground UX is implemented.
- Documentation updates in the implementation spec should target only the durable homes made stale by shipped behavior.
- The durable doc home for cross-file execution contracts is `v2/docs/`; operator-facing semantics also live there per [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
- Prefer one small v2 doc update that records the Phase 1 execution contract/boundary over broad usage docs; likely `v2/docs/v2-architecture.md` if the core/host seam becomes concrete.
- If existing durable docs remain accurate after implementation, the spec may state no doc change for that subspec rather than inventing prose.
- Acceptance criteria should require deterministic tests for outcome classification and output-contract enforcement without running the full future loop.
- Do not require PR creation, branch publication, daemon startup, structured logging backends, or config-driven agent ordering anywhere in this phase's spec.

## Refine turn 2

- Repo evidence supports three subspecs; `v2/src/` currently contains only `cli.ts` and its co-located test, so adding a fourth subspec now would be planning around nonexistent structure.
- Subspec 1 should explicitly replace the current sync-only `main(argv, io): number` boundary with an async-capable host seam if needed, while preserving injectable host I/O for direct module tests.
- Subspec 1 should keep argument parsing narrow: one implemented command path, one usage-error path for rejected future-phase flags, no command router or help system.
- Deferred to first consumer: exact argv grammar for target repo, spec path, and optional output location beyond the minimum needed to run one write step — pin when the first real caller is wired.
- Subspec 1 should define the core input as data-only plus host seams; repo discovery, process exits, and signal ownership stay in the CLI host.
- The draft should call out that `AbortSignal` propagation must be observable in tests without requiring real terminal signal delivery.
- `v2/docs/v2-build-order.md` is the binding Phase 1 sequencing source; `v2/docs/v2-architecture.md` is the eventual target shape and must not be treated as a requirement to land daemon-first machinery now.
- The draft should require any Phase 1 doc update to tighten that CLI-first-versus-daemon-later boundary if implementation makes the current architecture prose stale.
- Subspec 2 should pin fallback input as an ordered list supplied by the caller or a narrow default inside v2 source; do not pull `~/.jarvis` project config into this phase.
- Invocation outcome classification should be produced by a v2-owned adapter boundary, even if the first adapter shells out to existing CLIs with copied or ported heuristics.
- The draft should force an explicit acceptance-criteria decision on which v1 quota heuristics are copied into v2 now versus which are intentionally deferred; otherwise "reuse" will hide cross-tree design drift.
- Deferred to first consumer: support for user-configurable retry counts, backoff, or fallback suppression — pin when config owns agent policy.
- Subspec 2 should treat cancellation as terminal for the whole run, not a signal to try the next agent; fallback is for quota exhaustion, not host aborts.
- Subspec 3 should pin the observable success boundary in repo terms: worktree exists at the v2-owned path, lock coexistence rules hold, output artifacts satisfy the contract, and the resulting git state is inspectable.
- The draft should require a negative-path contract test where the agent reports terminal success but artifact validation fails; Phase 1 must surface a machine-checkable failure outcome, not silently accept the run.
- Deferred to first consumer: exact cleanliness requirement after a successful write step beyond what the artifact contract and worktree materialization need to prove — pin when a later workflow consumes clean/dirty state.
- Subspec 3 should forbid PR creation, branch publication, and ready/draft transitions in both tasks and acceptance criteria; worktree materialization ends before any publication lifecycle.
- The implementation spec should prefer updating `v2/docs/v2-build-order.md` only if Phase 1 deliverables or exclusions change, and `v2/docs/v2-architecture.md` only if the shipped core/host or output-contract boundary becomes more concrete than today's prose.
- If the implementation only makes existing docs more precise about already-decided Phase 1 behavior, one durable doc update is enough; do not add a new standalone usage guide for a one-command slice.

## Refine turn 3

- The draft should treat `v2/docs/v2-build-order.md` as the binding Phase 1 contract and treat the daemon-first text in `v2/docs/v2-architecture.md` as stale target-shape prose that the implementation spec may need to tighten.
- Subspec 1 should require direct module tests for both the CLI host seam and the host-agnostic core seam; the current `main(argv, io)` test shape is the only v2 host evidence on disk.
- The minimal CLI host contract should cover argv in, host I/O writes out, abort signal in, and exit-code mapping out; everything else is deferred.
- Deferred to first consumer: whether the CLI host returns a structured result plus separate exit-code mapper or a single host result object — pin when the first async caller is written.
- Subspec 1 acceptance criteria should reject "v2 not ready" as the command-path behavior once the write path exists; the implemented path must become the primary no-placeholder surface.
- The spec should pin one machine-checkable run outcome union at the core boundary and reuse it through the CLI host rather than inventing separate success vocabularies.
- Deferred to first consumer: exact human-facing stderr wording for usage errors and run failures — pin when operator output snapshots exist.
- Subspec 2 should require the fallback order source to be explicit in tests; hidden ambient defaults make quota behavior unreviewable.
- The invocation adapter contract should own raw process exit/stdout/stderr interpretation and emit classified outcomes upward; fallback policy should not parse CLI transcripts itself.
- The spec should require at least one acceptance test proving non-quota failure on the first agent does not fall through to the next agent.
- The spec should require at least one acceptance test proving quota exhaustion on the first agent does fall through to the next agent and stops after the first classified success.
- The spec should require at least one acceptance test proving cancellation during invocation yields terminal cancellation for the whole run with no later-agent attempt.
- Deferred to first consumer: whether "agent unavailable locally" is classified with non-retryable failure or its own adapter-local code — pin when a real adapter hits that case.
- Subspec 3 should make the worktree path a produced artifact of the run result, not an implicit side effect hidden only in logs.
- The output-contract slice should define failure as data, not prose; callers need a stable reason/category field to distinguish contract failure from invocation failure.
- Deferred to first consumer: exact contract-failure payload shape beyond category plus inspectable details needed for tests — pin when a second caller consumes it.
- Subspec 3 should require tests for preflight repo invariant failures before agent invocation when the target repo cannot support worktree materialization.
- The spec should force an explicit decision on whether `.jarvis.lock` coexistence is validated before worktree creation, after creation, or both; the acceptance criteria should name the chosen boundary.
- The draft should state that Phase 1 docs update exactly one durable home unless implementation changes both sequencing and architecture facts; duplicate Phase 1 summaries across docs are churn.
