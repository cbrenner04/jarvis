# First write behavior, end-to-end

Implement the Phase 1 build-order slot "First write step, end-to-end" from
`v2/spec/v2-meta-index.md`. This is the first real `v2/src` execution slice, not
another meta-spec cleanup.

A prior attempt (closed PR) built this but collapsed the architecture: a single
`runWriteStep` owned worktree acquisition, the quota-fallback invocation loop,
outcome-token parsing, contract dispatch, and result classification. That works
but hides the composition seam that is the entire point of v2 — and it leaned on
"step" (an orchestration word) for the behavior, edited the decided architecture
doc, and relocated v1 prompt code without refactoring it. This intent reshapes
the work around the layered model so the seams are honest from day one.

## Target outcome

One `write` **behavior**, invoked once from the v2 CLI: render its prompt
through the shared registry, invoke one configured agent (with quota fallback),
capture the outcome token, verify the output contract deterministically, and
materialize the result in a worktree under `~/.jarvis/worktrees`.

## Vocabulary (load-bearing)

- **`write` is a behavior** (`v2-architecture.md` loop primitive), never a
  "step." A *step* is the orchestration unit (behavior + prompt + contract) that
  a future runner sequences. Do not name the behavior, its module, its function,
  or its prompt `*-step` / `write.step`.
- The durable operator doc is named for the behavior, not a planning label
  (no `phase-1-*` filename).

## The seams to build (the actual reshape)

Even though `write` is the *first* agent-invoker, cut the generic layers the
architecture already declares distinct, rather than fusing them into one
function:

- **Agent invocation (shared, behavior-agnostic):** `(prompt, cwd, ordered
  bindings) -> ok | quota | error` with quota fallback over the effective order.
  Anything that invokes an agent reuses this; it knows nothing about `write`.
- **Step runner (shared):** invoke -> parse the outcome token (`done | no-work |
  blocked | progress`) -> on a terminal token run the step's declared contract ->
  classify into the typed result. The token vocabulary and contract dispatch
  live here, once — they are runner concerns per `v2-architecture.md`, not
  behavior-specific.
- **`write` behavior (behavior-specific):** supplies its prompt (`write.execute`)
  and its output contract. Approximately nothing else. `runWrite` is wiring that
  binds the behavior into the step runner.
- **Worktree lifecycle:** owned by the runner/git layer, not the behavior.

The reshape is judged by how thin `write` ends up: if write-specific code still
contains an invocation loop, token parsing, or contract dispatch, the seam was
not cut.

## Shared v1 reuse = refactor, not relocate

`biome.json` forbids `v2/**` importing `v1/**`, so reused prompt/agent/quota/lock
mechanics must come from root-shared modules. Promoting code to `src/shared/`
is a **refactor to the v2 bar**, reviewed on its own merits — not a lift-and-
shift that imports v1's unreviewed quality (the closed PR left `src/shared/
prompts/registry.ts` as a moved v1 body behind a re-export shim). Justify each
shared abstraction by the seam it owns. (A cohesive `PromptRegistry` surface that
owns load + lookup + render is a real improvement; wrapping the same procedural
code to look tidy is not.) Keep `jarvis1` green throughout via the rendered-
prompt snapshots — shared source is shared behavior.

## Scope

- v2 CLI path for one single `write` run.
- Shared agent-invocation layer with quota fallback (v1-tested semantics, not a
  second policy).
- Shared step runner: token capture + deterministic output-contract evaluation.
- `write` behavior: prompt + contract, registered through the shared registry.
- Worktree creation/reuse under `~/.jarvis/worktrees/<project>/<branch>/`,
  coexisting with `.jarvis.lock` (reuse the v1 lock contract end-to-end).
- Tests proving the e2e happy path and the key failure/contract edges.
- Operator-facing `v2/docs/` doc for running and verifying the write behavior.

## Constraints

- Phase 1 only: no automatic loop, no workflow runner, no daemon/IPC/TUI, no PR
  lifecycle, no project-config matrix beyond the one binding needed to run one
  agent. `progress` surfaces as a non-complete result with no retry; looping is
  Phase 2.
- No durable SQLite/state: the worktree + git checkout are the only persistence.
  Resume/attempt-ledger machinery belongs later.
- Keep the core host-agnostic and abortable (`AbortSignal`); process exit codes,
  stdio formatting, and signal handling stay in the CLI host.
- **Do not edit `v2/docs/v2-architecture.md`.** It records decided architecture;
  implementation conforms to it. Phase status and operator flow go in a
  `v2/docs/` operator doc, not the arch doc. If implementation reveals a genuine
  architectural decision to change, raise it as a decision — don't narrate status
  into the doc.
- Contract checks run only on terminal claims `done`/`no-work`; a miss surfaces
  as a hard non-success result, never a hidden second agent call or a silent
  reclassification.
- Align worktree locking with existing `.jarvis.lock` semantics (same JSON
  payload, busy-vs-stale behavior, best-effort `info/exclude`); do not invent a
  v2-only lock format. Lock lifetime spans acquisition through result
  materialization.

## Out of scope

Repeat-until-done loops, kill-resume, daemonized/detached execution, multi-step
workflows, human-loop/review behavior, concurrency/admission.

## Deferred to first consumer

- Exact CLI spelling/argument shape — pin when operator docs + CLI tests need it.
- Worktree slug, collision suffixing, branch naming — pin at the first
  materialization call site.
- The narrow output-contract primitive set beyond the decided token semantics —
  pin when `write` names its concrete artifact checks.
- Whether the shared extraction lands as one plumbing subspec or splits by seam —
  pin when draft sizing chooses the smallest reviewable PRs.

## Refinement notes

- Draft as multiple atomic subspecs (PR-size constraint); the seam split above is
  the natural cut: shared invocation, shared runner+contract, `write` behavior,
  worktree lifecycle.
- Reuse the shared top-level prompt registry; do not add a v2-local prompt source
  or a second prompt metadata contract.
- Do not treat `v1/src/worktree.ts` as reusable: it hard-codes repo-local
  `.worktree/<spec>` and v1 branch flow. The external path needs its own helper
  reusing only compatible semantics.
- Add one shared `write` prompt artifact under top-level `prompts/`, registered
  through the explicit seed list; no existing write prompt renders today.
