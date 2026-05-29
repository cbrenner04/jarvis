---
name: first-write-step-e2e-2
---

# Intent

Implement the next empty checkbox in `v2/spec/v2-meta-index.md`: Phase 1,
"First write step, end-to-end."

This should draft the first real `v2/src` execution slice, not another meta-spec
cleanup. The target outcome is one `write` step that runs once from the v2 CLI:
render the prompt through the shared registry, invoke one configured agent,
capture the outcome token, validate the output contract deterministically, and
materialize the result in a worktree under `~/.jarvis/worktrees`.

The phase should keep the architecture honest from day one:

- Build a host-agnostic core function that owns the one-step run and accepts
  cancellation via `AbortSignal`.
- Keep the CLI host thin. It should parse arguments, call the core, report the
  result, and own process-facing concerns only.
- Treat the worktree plus git state as the only persistence for this phase. Do
  not introduce durable SQLite state yet.
- Land quota fallback in the invocation layer now, since Phase 1 is where the
  first real agent call happens.

Scope to cover:

- v2 CLI path for starting a single write-step run.
- Prompt rendering through the shared prompt registry inputs this phase needs.
- One agent invocation path with one cli+model binding.
- Outcome capture and deterministic output-contract evaluation.
- Worktree creation/reuse behavior under `~/.jarvis/worktrees`, including
  coexistence with `.jarvis.lock`.
- Tests that prove the end-to-end happy path and the key failure/contract edges.
- Operator-facing docs for how to run and verify the first v2 write step.

Constraints:

- Keep this to Phase 1 only. No loop, no workflow runner, no daemon host, no
  IPC, no TUI, no PR lifecycle, no project-config matrix beyond the minimum
  binding needed to run one agent.
- Do not invent persistence that Phase 2 is supposed to earn. Resume/state
  machinery belongs later.
- Reuse existing repo conventions where possible instead of introducing a second
  architecture for prompts, agents, or worktrees.
- Keep the spec outcome implementation-focused: merged code, tests, and docs
  outside the active spec tree.

Out of scope:

- Repeating until artifact/criteria/blocker.
- Kill-resume semantics.
- Daemonized or detached execution.
- Multi-step workflows.
- Human-loop or review-loop behavior.
- Concurrency/admission.

The eventual spec should make verification concrete around target state outside
the spec tree, for example:

- v2 tests covering a successful single-step run and contract failure handling.
- Root verification surfaces still passing with the new v2 behavior.
- A documented operator flow for invoking the Phase 1 CLI and understanding the
  produced worktree/output.

## Refinement

- Draft this phase as multiple atomic subspecs; one monolith would violate the repo PR-size constraint and blur the library, invocation, and worktree seams.
- Keep the first subspec on the minimum runnable spine: CLI entrypoint, host-agnostic one-step core, one shared-prompt render, one adapter binding, one typed result surface.
- Split worktree materialization and lock coexistence into their own subspec if they cannot be proved with isolated tests from the core happy path.
- Split quota fallback and contract-edge handling into their own subspec if they materially expand adapter or result-state scope beyond one reviewable change.
- Reuse the shared top-level prompt registry; do not add a v2-local prompt source or a second prompt metadata contract.
- Reuse existing agent adapter and quota-classification mechanics where possible; Phase 1 should not invent a second fallback policy beside the v1-tested semantics.
- Preserve the architecture token vocabulary from `v2/docs/v2-architecture.md`: `done`, `no-work`, `blocked`, `progress`.
- In this one-shot phase, `progress` is surfaced as a non-complete result with no automatic retry; looping belongs to Phase 2.
- Deterministic output-contract checks run only on terminal claims `done` and `no-work`; a contract miss must surface as a hard result, not trigger a hidden second agent call.
- `blocked` stops the run and reports the blocker outcome; Phase 1 does not add a human-loop transport around it.
- Keep the core library API host-agnostic and abortable; process exit codes, stdio formatting, and signal handling stay in the CLI host.
- Treat the worktree and git checkout as the only persisted run state; no SQLite bootstrap, run row, attempt ledger, or transcript store in this phase.
- Align worktree locking with existing `.jarvis.lock` semantics instead of inventing a v2-only lockfile format or location.
- Cover stale-lock recovery only if it falls out of the reused worktree-lock path; otherwise defer lock-healing expansion and prove only coexistence with the existing lock contract.
- Deferred to first consumer: exact Phase 1 CLI spelling and argument shape — pin when operator docs and CLI tests need it.
- Deferred to first consumer: worktree naming slug, collision suffixing, and branch naming details under `~/.jarvis/worktrees` — pin when the first materialization call site is drafted.
- Deferred to first consumer: the narrow Phase 1 output-contract primitive set beyond the already-decided terminal-token semantics — pin when the first write step names its concrete artifact checks.
- Durable docs for operator-facing Phase 1 behavior must live in `v2/docs/`, not only the dated spec tree.
- Use `v2/docs/v2-architecture.md` for cross-file core/host/worktree boundary changes and a separate operator-facing `v2/docs/` home for CLI invocation and verification flow if no current durable doc fits cleanly.
- Update `v2/docs/v2-build-order.md` only if drafting discovers Phase 1 scope drift; do not churn it just to mirror the spec.
- The first Phase 1 worktree subspec should pin the architecture path `~/.jarvis/worktrees/<project>/<branch>/`; do not fall back to repo-local `.worktree/` layout in v2.
- Because `biome.json` forbids `v2/**` importing `v1/**`, reused prompt, agent, quota, or lock mechanics must come from root-shared modules or be extracted there as part of the phase; do not punch a one-off cross-tree import hole.
- If Phase 1 materializes `.jarvis.lock` in the external worktree, reuse the v1 lock contract end-to-end: same JSON payload fields, same busy-vs-stale behavior, same best-effort `info/exclude` protection against staging the lock file.
- In the one-shot Phase 1 host, the cross-process lock lifetime should span the full run from worktree acquisition through result materialization, matching the architecture rule that the worktree stays checked out to one run until terminal outcome.
- Existing prompt-registry, prompt-renderer, quota-classifier, and lock code lives only under `v1/src`; Phase 1 needs an explicit shared-source extraction seam before `v2/src` can consume any of it.
- Do not treat `v1/src/worktree.ts` as reusable Phase 1 materialization code; it hard-codes repo-local `.worktree/<spec>` and v1 branch flow, so the external `~/.jarvis/worktrees/<project>/<branch>/` path needs its own helper that only reuses compatible semantics.
- The first runnable write-step subspec must add one shared `write` prompt artifact under top-level `prompts/` and register it through the explicit registry seed list; the repo has no existing write-step prompt to render today.
- Deferred to first consumer: whether shared-source extraction for prompt rendering, quota fallback, and lock semantics lands as one plumbing subspec or is split by seam — pin when draft sizing chooses the smallest reviewable PRs.

## Blocker

Review and approve `v2/spec/2026-05-29T01-29-17Z-first-write-step-e2e-2/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis1 plan --resume-draft v2/spec/2026-05-29T01-29-17Z-first-write-step-e2e-2/intent.md`
