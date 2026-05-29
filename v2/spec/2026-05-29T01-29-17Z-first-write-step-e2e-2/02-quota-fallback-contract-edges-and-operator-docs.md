# 02 - Quota fallback, contract edges, and operator docs

## Decisions

- Reuse existing quota-classification and fallback mechanics through a shared seam where possible; do not invent a second Phase 1 fallback policy.
- Keep Phase 1 binding minimal: one configured cli+model plus ordered fallback behavior in the invocation layer.
- Treat quota fallback as invocation behavior, not workflow behavior; the one-shot core asks for one effective order and stops after the first non-quota result.
- On `done` and `no-work`, run deterministic contract checks and convert a miss into a hard non-success result with no hidden second agent call.
- On `blocked`, stop immediately and report the blocker outcome; do not add a human-loop transport.
- On `progress`, stop immediately and report a non-complete result; do not re-enter the step.
- Keep process exit codes and terminal formatting in the CLI host only.
- Add the durable operator flow in `v2/docs/`; do not leave Phase 1 invocation and verification guidance only in the dated spec tree.
- Update `v2/docs/v2-build-order.md` only if implementation decisions force real Phase 1 scope drift; otherwise leave it unchanged.

## Tasks

- Add quota fallback support to the Phase 1 invocation layer.
- Add deterministic contract-edge handling for `done`, `no-work`, `blocked`, and `progress`.
- Extend tests for quota exhaustion, fallback success, contract failure after a terminal claim, blocker reporting, and progress-without-retry.
- Add the durable Phase 1 operator doc covering how to invoke the CLI, how to verify the produced worktree/output, and how to read the surfaced outcome.

## Documentation updates

- Add or update the durable operator-facing Phase 1 run doc in `v2/docs/`.
- Update `v2/docs/v2-architecture.md` for any shipped contract-edge or fallback semantics that become more concrete than the current wording.

## Acceptance criteria

- [x] Automated coverage proves Phase 1 retries the next configured agent only on quota-classified failure and surfaces the first non-quota result without loop semantics.
- [x] Automated coverage proves `done` and `no-work` run deterministic contract checks, a contract miss surfaces as a hard result, `blocked` stops immediately, and `progress` returns non-complete with no retry.
- [x] Durable operator docs in `v2/docs/` pin one concrete Phase 1 CLI invocation, the expected worktree/output side effects, and the meaning of each surfaced outcome.
- [x] Root verification remains green after the full Phase 1 slice lands: `bun run typecheck` and `bun test`.
